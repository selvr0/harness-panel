import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HarnessGroup, HarnessItem, TrashedHarness } from '../types'
import {
  type HookSettings,
  insertHookIntoSettings,
  localSettingsPath,
  projectSettingsPath,
  removeHookFromSettings,
  setOrDeleteKey,
  userSettingsPath,
} from './settings-files'
import { type Messages, MESSAGES, resolveMessages } from './i18n'
import {
  type Platform,
  basename,
  buildMakeDirCommand,
  buildMoveCommand,
  buildMoveToTrashCommands,
  buildOpenInEditorCommands,
  buildRemoveFileCommand,
  buildTrashInfo,
  buildWindowsRestoreCommand,
  dirname,
  isAbsolutePath,
  linuxTrashDirs,
  normalizePath,
  readTrashInfoPath,
  toNativePath,
} from './platform'
import {
  type HookOutcome,
  type HookRun,
  hookTarget,
  isMatchedByHookMatcher,
  mergeHookOutcomes,
  readHookOutcome,
  resolveMatcherValue,
} from './hook-runner'

// $ 를 받는 함수는 모두 이 파일 안에 있어야 함 (mod 규칙: $ 는 import 한 함수로 넘길 수 없음)
type Engine = EngineInterface

// 패널 글자. register 가 /config 의 language 값으로 정함 (기본 영어)
let text: Messages = MESSAGES.en

// ── 운영체제·경로 ──────────────────────────────────

// 한 번 알아낸 운영체제. 다시 로드되면 다시 알아냄
let detectedPlatform: Platform | null = null

async function detectPlatform($: Engine): Promise<Platform> {
  if (detectedPlatform) return detectedPlatform
  if ((await $.env.get('OS')) === 'Windows_NT') return (detectedPlatform = 'windows')
  const uname = await runCommand($, ['uname', '-s'])
  return (detectedPlatform = uname.stdout.trim() === 'Darwin' ? 'mac' : 'linux')
}

// 없는 명령을 실행하면 예외가 날 수 있어서, 실패로 바꿔서 돌려줌
async function runCommand($: Engine, argv: string[]) {
  try {
    return await $.process.run(argv)
  } catch (error) {
    return { exitCode: 127, stdout: '', stderr: (error as Error).message }
  }
}

// 차례로 실행해서 처음 성공한 결과를 돌려줌. 다 실패하면 마지막 실패 결과
async function runFirstSuccessful($: Engine, commands: string[][]) {
  let last = { exitCode: 1, stdout: '', stderr: '' }
  for (const argv of commands) {
    last = await runCommand($, argv)
    if (last.exitCode === 0) return last
  }
  return last
}

// ── settings 파일 읽고 쓰기 ─────────────────────────

async function readJsonFile($: Engine, path: string): Promise<Record<string, any> | null> {
  try {
    if (!(await $.fs.exists(path))) return null
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

async function writeJsonFile($: Engine, path: string, value: Record<string, any>) {
  await $.fs.write(path, JSON.stringify(value, null, 2) + '\n')
}

// settings 파일 하나를 읽어 고친 뒤 다시 씀. 파일이 없으면 빈 객체에서 시작함
async function editSettingsFile($: Engine, path: string, edit: (settings: Record<string, any>) => void) {
  const settings = (await readJsonFile($, path)) ?? {}
  edit(settings)
  await writeJsonFile($, path, settings)
}

// ── 지금 폴더의 하네스 목록 모으기 ───────────────────

// 이 mod 가 직접 막는 것들. $.store 에 폴더별로 저장함
// key:   "off:<세션 루트>"
// value: {
//   pluginSkills: ["<플러그인>:<스킬>", ...]      꺼 둔 플러그인 스킬 이름
//   hooks:        ["PreToolUse|Bash", ...]          꺼 둔 훅의 "이벤트|matcher"
// }
type ModOffList = { pluginSkills: string[]; hooks: string[] }

async function readModOffList($: Engine, root: string): Promise<ModOffList> {
  const saved = (await $.store.get(`off:${root}`)) as Partial<ModOffList> | undefined
  return { pluginSkills: saved?.pluginSkills ?? [], hooks: saved?.hooks ?? [] }
}

async function writeModOffList($: Engine, root: string, list: ModOffList) {
  await $.store.set(`off:${root}`, list)
}

// 한 번 본 스킬 목록. 꺼진 스킬은 Claude Code 목록에서 사라지므로, 패널에 계속 보이게 기억해 둠
// key:   "seen-skills:<세션 루트>"
// value: [{ name: <스킬 이름>, source: <Claude Code 가 주는 출처>, pluginName?: <플러그인 이름> }]
type SeenSkill = { name: string; source: string; pluginName?: string }

async function forgetSeenSkill($: Engine, root: string, name: string) {
  const seen = ((await $.store.get(`seen-skills:${root}`)) as SeenSkill[] | undefined) ?? []
  await $.store.set(`seen-skills:${root}`, seen.filter(s => s.name !== name))
}

const CORE_GROUP_IDS = ['proj', 'user', 'synced'] as const

function describeCoreGroup(id: 'proj' | 'user' | 'synced' | 'builtin'): Omit<HarnessGroup, 'items'> {
  return { id, ...text.groups[id] }
}

// 경로를 패널에 보이게 줄임
//   <세션 루트>/<나머지> → <나머지>
//   <홈>/<나머지>       → ~/<나머지>
function shortenPath(path: string, root: string, home: string) {
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}

async function collectListedSkills($: Engine, root: string): Promise<SeenSkill[]> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const listed = usage.context.breakdown?.skills?.skillFrontmatter ?? []
  const seen = ((await $.store.get(`seen-skills:${root}`)) as SeenSkill[] | undefined) ?? []
  const byName = new Map<string, SeenSkill>(seen.map(s => [s.name, s]))
  for (const s of listed) byName.set(s.name, { name: s.name, source: s.source, pluginName: s.pluginName })
  const merged = [...byName.values()]
  await $.store.set(`seen-skills:${root}`, merged)
  return merged
}

function resolveSkillGroupId(skill: SeenSkill) {
  if (skill.pluginName) return `plugin:${skill.pluginName}`
  const source = skill.source.toLowerCase()
  if (source.includes('project') || source.includes('local')) return 'proj'
  if (source.includes('synced')) return 'synced'
  if (source.includes('user')) return 'user'
  return 'builtin'
}

// 스킬 파일이 있을 만한 자리를 차례로 보고, 있는 첫 자리를 고름
//   스킬: <폴더>/skills/<이름>/SKILL.md  → 휴지통 대상은 <이름> 폴더
//   명령: <폴더>/commands/<이름>.md      → 휴지통 대상은 그 파일
async function findSkillFile(
  $: Engine,
  bases: string[],
  name: string,
): Promise<{ filePath: string; trashPath: string } | undefined> {
  for (const base of bases) {
    const skillFile = `${base}/skills/${name}/SKILL.md`
    if (await $.fs.exists(skillFile)) return { filePath: skillFile, trashPath: `${base}/skills/${name}` }
    const commandFile = `${base}/commands/${name}.md`
    if (await $.fs.exists(commandFile)) return { filePath: commandFile, trashPath: commandFile }
  }
  return undefined
}

// anthropic-skills 는 ~/.claude/skills/synced/<버킷 id>/<이름>/SKILL.md 에 있음
async function listSyncedSkillBases($: Engine, home: string) {
  const syncedDir = `${home}/.claude/skills/synced`
  if (!(await $.fs.exists(syncedDir))) return []
  const entries = await $.fs.list(syncedDir)
  return entries.filter(e => e.kind === 'dir').map(e => `${syncedDir}/${e.name}`)
}

// 훅 command 에서 스크립트 파일 경로를 뽑음
//   command 안의 <스크립트>.py·.sh·.js 같은 경로를 찾고
//   $CLAUDE_PROJECT_DIR → 세션 루트, $CLAUDE_PLUGIN_ROOT → 플러그인 폴더, $HOME·~ → 홈 으로 바꿈
function resolveHookScriptPath(command: string, root: string, home: string, pluginRoot?: string) {
  const match = command.match(/["']?([^\s"']+\.(?:py|sh|mjs|cjs|js|ts))["']?/)
  if (!match?.[1]) return undefined
  let path = normalizePath(match[1])
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?|%CLAUDE_PROJECT_DIR%/g, root)
    .replace(/\$\{?CLAUDE_PLUGIN_ROOT\}?|%CLAUDE_PLUGIN_ROOT%/g, pluginRoot ?? '')
    .replace(/\$\{?HOME\}?|%USERPROFILE%/g, home)
    .replace(/^~(?=\/)/, home)
  if (!isAbsolutePath(path)) path = `${root}/${path}`
  return path
}

function describeHookCommand(command: string) {
  const script = command.match(/([\w.-]+\.(?:py|sh|mjs|cjs|js|ts))/)
  return script?.[1] ?? command.slice(0, 32)
}

function describeHookEvent(event: string, matcher: string) {
  if (event === 'PreToolUse' && matcher && matcher !== '*') return text.hookBeforeTool(matcher)
  if (event === 'PostToolUse' && matcher && matcher !== '*') return text.hookAfterTool(matcher)
  return text.hookEvents[event] ?? event
}

type HookSource = {
  // id 에 쓰는 출처 이름. "project" | "local" | "user" | 플러그인 이름
  name: string
  hooks: HookSettings | undefined
  // 내 settings 파일이면 그 경로. 플러그인 훅이면 undefined (휴지통 불가)
  settingsFile?: string
  pluginRoot?: string
}

// legacyPairs: 예전 저장 방식("<이벤트>|<matcher>")과 지금 방식(훅 한 개)의 짝을 모음. 예전 값을 바꿀 때 씀
function buildHookItems(
  source: HookSource,
  offHooks: string[],
  root: string,
  home: string,
  legacyPairs: [string, string][],
): HarnessItem[] {
  const items: HarnessItem[] = []
  for (const [event, entries] of Object.entries(source.hooks ?? {})) {
    for (const entry of entries ?? []) {
      const matcher = entry.matcher ?? ''
      for (const hook of entry.hooks ?? []) {
        const command = String(hook.command ?? '')
        const target = hookTarget(event, matcher, command)
        legacyPairs.push([`${event}|${matcher}`, target])
        const scriptPath = resolveHookScriptPath(command, root, home, source.pluginRoot)
        items.push({
          id: `hook:${source.name}:${event}|${matcher}:${command}`,
          label: describeHookCommand(command),
          detail: describeHookEvent(event, matcher),
          kind: 'hook',
          isOn: !offHooks.includes(target) && !offHooks.includes(`${event}|${matcher}`),
          control: 'hook',
          target,
          filePath: scriptPath,
          displayPath: scriptPath ? shortenPath(scriptPath, root, home) : undefined,
          trashable: source.settingsFile
            ? { kind: 'hook', settingsFile: source.settingsFile, event, matcher, command, scriptPath }
            : undefined,
          untrashableReason: source.settingsFile ? undefined : text.untrashable.pluginHook,
        })
      }
    }
  }
  return items
}

// 같은 스크립트를 훅 두 개 이상이 쓰면, 하나를 휴지통으로 옮길 때 스크립트는 남겨 둠
function keepSharedHookScripts(items: HarnessItem[]) {
  const useCount = new Map<string, number>()
  for (const i of items) if (i.filePath) useCount.set(i.filePath, (useCount.get(i.filePath) ?? 0) + 1)
  for (const i of items) {
    if (i.trashable?.kind === 'hook' && i.trashable.scriptPath && (useCount.get(i.trashable.scriptPath) ?? 0) > 1) {
      i.trashable = { ...i.trashable, scriptPath: undefined }
    }
  }
}

type InstalledPlugin = { id: string; name: string; installPath: string }

// ~/.claude/plugins/installed_plugins.json 에서 이 폴더에 설치된 플러그인만 고름
// (전역 설치 + 이 폴더 경로로 설치된 프로젝트 설치)
async function collectInstalledPlugins($: Engine, home: string, root: string): Promise<InstalledPlugin[]> {
  const file = await readJsonFile($, `${home}/.claude/plugins/installed_plugins.json`)
  const result: InstalledPlugin[] = []
  for (const [id, entries] of Object.entries((file?.plugins ?? {}) as Record<string, any[]>)) {
    const entry = entries.find(e => e.scope === 'user' || (e.projectPath && root.startsWith(normalizePath(e.projectPath))))
    const name = id.split('@')[0] ?? id
    // 이 패널 자신은 뺌. 여기서 끄면 패널이 사라져 다시 켤 곳이 없음
    if (name === 'harness-panel') continue
    if (entry) result.push({ id, name, installPath: normalizePath(entry.installPath) })
  }
  return result
}

// 예전에는 훅을 "<이벤트>|<matcher>" 묶음으로 껐음. 그 값을 묶음 안 훅 하나하나의 값으로 바꿔 저장함
async function migrateLegacyHookOffKeys($: Engine, root: string, off: ModOffList, legacyPairs: [string, string][]) {
  const legacyKeys = new Set(legacyPairs.map(([legacy]) => legacy))
  if (!off.hooks.some(key => legacyKeys.has(key))) return
  const hooks = new Set(off.hooks.filter(key => !legacyKeys.has(key)))
  for (const [legacy, target] of legacyPairs) if (off.hooks.includes(legacy)) hooks.add(target)
  await writeModOffList($, root, { ...off, hooks: [...hooks] })
}

async function collectHarnessGroups($: Engine, root: string, home: string): Promise<HarnessGroup[]> {
  // $.settings.read() 는 파일을 고친 직후엔 옛 값을 줄 수 있음. 토글 직후 화면이 되돌아가지 않게 파일을 직접 읽음
  const userFile = (await readJsonFile($, userSettingsPath(home))) ?? {}
  const projectFile = (await readJsonFile($, projectSettingsPath(root))) ?? {}
  const localFile = (await readJsonFile($, localSettingsPath(root))) ?? {}
  // 우선순위: skillOverrides 는 project > local·user, enabledPlugins 는 local > project > user
  const skillOverrides: Record<string, string> = {
    ...userFile.skillOverrides,
    ...localFile.skillOverrides,
    ...projectFile.skillOverrides,
  }
  const enabledPlugins: Record<string, boolean> = {
    ...userFile.enabledPlugins,
    ...projectFile.enabledPlugins,
    ...localFile.enabledPlugins,
  }
  const off = await readModOffList($, root)

  const groups = new Map<string, HarnessGroup>()
  for (const id of CORE_GROUP_IDS) groups.set(id, { ...describeCoreGroup(id), items: [] })

  const plugins = await collectInstalledPlugins($, home, root)
  for (const p of plugins) {
    groups.set(`plugin:${p.name}`, {
      id: `plugin:${p.name}`,
      tab: p.name.replace(/-lsp$/, ''),
      title: p.name,
      where: text.groups.pluginWhere,
      pluginId: p.id,
      isPluginOn: enabledPlugins[p.id] === true,
      items: [],
    })
  }
  groups.set('builtin', { ...describeCoreGroup('builtin'), items: [] })

  // 훅: 이 폴더(project + local), 전역(user), 플러그인 hooks.json
  const myHookSources: [HookSource, string][] = [
    [{ name: 'project', hooks: projectFile.hooks, settingsFile: projectSettingsPath(root) }, 'proj'],
    [{ name: 'local', hooks: localFile.hooks, settingsFile: localSettingsPath(root) }, 'proj'],
    [{ name: 'user', hooks: userFile.hooks, settingsFile: userSettingsPath(home) }, 'user'],
  ]
  const myHookItems: HarnessItem[] = []
  const legacyPairs: [string, string][] = []
  for (const [source, groupId] of myHookSources) {
    const items = buildHookItems(source, off.hooks, root, home, legacyPairs)
    myHookItems.push(...items)
    groups.get(groupId)!.items.push(...items)
  }
  keepSharedHookScripts(myHookItems)
  for (const p of plugins) {
    const file = await readJsonFile($, `${p.installPath}/hooks/hooks.json`)
    const source: HookSource = { name: p.name, hooks: (file?.hooks ?? file) as HookSettings, pluginRoot: p.installPath }
    groups.get(`plugin:${p.name}`)!.items.push(...buildHookItems(source, off.hooks, root, home, legacyPairs))
  }
  await migrateLegacyHookOffKeys($, root, off, legacyPairs)

  // 스킬
  const syncedBases = await listSyncedSkillBases($, home)
  for (const skill of await collectListedSkills($, root)) {
    const groupId = resolveSkillGroupId(skill)
    // 설치 목록에 없는 플러그인(--plugin-dir 로 띄운 것)도 플러그인 섹션을 따로 만듦
    if (skill.pluginName && !groups.has(groupId)) {
      groups.set(groupId, { id: groupId, tab: skill.pluginName, title: skill.pluginName, where: text.groups.pluginWhere, items: [] })
    }
    const group = groups.get(groupId) ?? groups.get('builtin')!
    const plugin = plugins.find(p => p.name === skill.pluginName)
    const isPluginSkill = !!skill.pluginName
    const shortName = isPluginSkill ? skill.name.replace(`${skill.pluginName}:`, '') : skill.name.replace(/^anthropic-skills:/, '')

    const bases =
      groupId === 'proj' ? [`${root}/.claude`]
      : groupId === 'user' ? [`${home}/.claude`]
      : groupId === 'synced' ? syncedBases
      : plugin ? [plugin.installPath]
      : []
    const found = bases.length ? await findSkillFile($, bases, shortName) : undefined
    const isMine = groupId === 'proj' || groupId === 'user'
    // 내 스킬인데 파일이 없으면 이미 지웠거나 옮긴 것. 목록에서 뺌
    if (isMine && !found) continue

    group.items.push({
      id: `skill:${skill.name}`,
      label: shortName,
      kind: 'skill',
      isOn: isPluginSkill ? !off.pluginSkills.includes(skill.name) : skillOverrides[skill.name] !== 'off',
      control: isPluginSkill ? 'pluginSkill' : 'skillOverrides',
      target: skill.name,
      filePath: found?.filePath,
      displayPath: found ? shortenPath(found.filePath, root, home) : undefined,
      trashable: isMine && found ? { kind: 'skill', path: found.trashPath } : undefined,
      untrashableReason: isMine
        ? undefined
        : isPluginSkill ? text.untrashable.pluginSkill
        : groupId === 'synced' ? text.untrashable.synced
        : text.untrashable.builtin,
    })
  }

  // skillOverrides 로 꺼 둔 스킬은 Claude Code 목록에서 빠짐. 패널이 한 번도 못 본 것도 파일이 있으면 꺼진 채로 보여줌
  const listedTargets = new Set([...groups.values()].flatMap(g => g.items.map(i => i.target)))
  for (const [name, value] of Object.entries(skillOverrides)) {
    if (value !== 'off' || listedTargets.has(name)) continue
    for (const [groupId, base] of [['proj', `${root}/.claude`], ['user', `${home}/.claude`]] as const) {
      const found = await findSkillFile($, [base], name)
      if (!found) continue
      groups.get(groupId)!.items.push({
        id: `skill:${name}`,
        label: name,
        kind: 'skill',
        isOn: false,
        control: 'skillOverrides',
        target: name,
        filePath: found.filePath,
        displayPath: shortenPath(found.filePath, root, home),
        trashable: { kind: 'skill', path: found.trashPath },
      })
      break
    }
  }

  for (const g of groups.values()) {
    g.items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'skill' ? -1 : 1))
  }
  return [...groups.values()].filter(g => g.items.length > 0 || g.pluginId)
}

// ── 에디터로 열기·휴지통 ───────────────────────────

async function openFileInEditor($: Engine, path: string) {
  const platform = await detectPlatform($)
  const result = await runFirstSuccessful($, buildOpenInEditorCommands(platform, path))
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || text.error.cannotOpen(path))
}

// 운영체제 휴지통으로 옮김
// 반환값: 휴지통 안의 경로. 운영체제가 알려주지 않으면(윈도우, 리눅스 gio) undefined
async function moveToSystemTrash($: Engine, path: string, home: string): Promise<string | undefined> {
  const platform = await detectPlatform($)
  const result = await runFirstSuccessful($, buildMoveToTrashCommands(platform, path))
  if (result.exitCode === 0) {
    return platform === 'mac' && result.stdout.trim() ? normalizePath(result.stdout.trim()).replace(/\/+$/, '') : undefined
  }
  if (platform !== 'linux') throw new Error(result.stderr.trim() || text.error.cannotMove(path))

  // 리눅스에 gio·trash-put 이 없으면 freedesktop 휴지통으로 직접 옮김
  const { files, info } = linuxTrashDirs(home)
  const name = `${basename(path)}-${Date.now()}`
  await runCommand($, buildMakeDirCommand(platform, files))
  await runCommand($, buildMakeDirCommand(platform, info))
  const moved = await runCommand($, buildMoveCommand(platform, path, `${files}/${name}`))
  if (moved.exitCode !== 0) throw new Error(moved.stderr.trim() || text.error.cannotMove(path))
  await $.fs.write(`${info}/${name}.trashinfo`, buildTrashInfo(path, new Date()))
  return `${files}/${name}`
}

// 리눅스 휴지통에서 원래 경로가 같은 항목을 찾음. 반환값: { 파일 경로, info 파일 경로 }
async function findInLinuxTrash($: Engine, originalPath: string, home: string) {
  const { files, info } = linuxTrashDirs(home)
  if (!(await $.fs.exists(info))) return undefined
  for (const entry of await $.fs.list(info)) {
    if (!entry.name.endsWith('.trashinfo')) continue
    const infoPath = `${info}/${entry.name}`
    if (readTrashInfoPath(await $.fs.read(infoPath)) === originalPath) {
      return { trashedPath: `${files}/${entry.name.slice(0, -'.trashinfo'.length)}`, infoPath }
    }
  }
  return undefined
}

async function moveBackFromTrash($: Engine, originalPath: string, trashedPath: string | undefined, home: string) {
  if (await $.fs.exists(originalPath)) throw new Error(text.error.alreadyExists(originalPath))
  const platform = await detectPlatform($)

  if (!trashedPath && platform === 'windows') {
    const restored = await runCommand($, buildWindowsRestoreCommand(originalPath))
    if (restored.exitCode !== 0) throw new Error(text.error.notInTrash)
    return
  }

  let infoPath: string | undefined
  if (!trashedPath && platform === 'linux') {
    const found = await findInLinuxTrash($, originalPath, home)
    trashedPath = found?.trashedPath
    infoPath = found?.infoPath
  }
  if (!trashedPath || !(await $.fs.exists(trashedPath))) throw new Error(text.error.notInTrash)

  await runCommand($, buildMakeDirCommand(platform, dirname(originalPath)))
  const moved = await runCommand($, buildMoveCommand(platform, trashedPath, originalPath))
  if (moved.exitCode !== 0) throw new Error(moved.stderr.trim() || text.error.cannotMove(trashedPath))
  if (platform === 'linux') {
    const linuxInfo = infoPath ?? `${linuxTrashDirs(home).info}/${basename(trashedPath)}.trashinfo`
    await runCommand($, buildRemoveFileCommand(platform, linuxInfo))
  }
}

// 하네스 한 줄을 휴지통으로 옮기고, 되돌릴 때 필요한 정보를 돌려줌
//   스킬: 스킬 폴더(또는 명령 파일)를 운영체제 휴지통으로
//   훅:   settings 에서 그 훅을 빼고, 스크립트 파일은 운영체제 휴지통으로
async function moveHarnessToTrash($: Engine, item: HarnessItem, home: string): Promise<TrashedHarness> {
  const source = item.trashable
  if (!source) throw new Error(item.untrashableReason ?? text.error.cannotTrash)

  if (source.kind === 'skill') {
    const trashedPath = await moveToSystemTrash($, source.path, home)
    return { id: item.id, label: item.label, kind: item.kind, originalPath: source.path, trashedPath }
  }

  let removed: Record<string, unknown> | undefined
  await editSettingsFile($, source.settingsFile, settings => {
    removed = removeHookFromSettings(settings, source.event, source.matcher, source.command)
  })
  if (!removed) throw new Error(text.error.hookNotFound)
  const hook = { settingsFile: source.settingsFile, event: source.event, matcher: source.matcher, entry: removed }

  if (!source.scriptPath || !(await $.fs.exists(source.scriptPath))) {
    return { id: item.id, label: item.label, kind: item.kind, hook }
  }
  const trashedPath = await moveToSystemTrash($, source.scriptPath, home)
  return { id: item.id, label: item.label, kind: item.kind, originalPath: source.scriptPath, trashedPath, hook }
}

async function restoreHarnessFromTrash($: Engine, trashed: TrashedHarness, home: string) {
  if (trashed.originalPath) await moveBackFromTrash($, trashed.originalPath, trashed.trashedPath, home)
  const hook = trashed.hook
  if (hook) {
    await editSettingsFile($, hook.settingsFile, settings => {
      insertHookIntoSettings(settings, hook.event, hook.matcher, hook.entry)
    })
  }
}

const PANE = 'harness'
const PANE_COLUMNS = 50

const groupsAtom = atom({ plugin: 'harness-panel', key: 'groups' } as const, [] as HarnessGroup[])
const openGroupsAtom = atom(
  { plugin: 'harness-panel', key: 'openGroups' } as const,
  { proj: true, user: true } as Record<string, boolean>,
)
const selectedItemAtom = atom({ plugin: 'harness-panel', key: 'selectedItem' } as const, null as string | null)
const confirmingTrashAtom = atom({ plugin: 'harness-panel', key: 'confirmingTrash' } as const, null as string | null)
const trashAtom = atom({ plugin: 'harness-panel', key: 'trash' } as const, [] as TrashedHarness[])

// 경로는 모두 "/" 로 맞춤. 홈은 맥·리눅스 HOME, 윈도우 USERPROFILE
async function readSessionPaths($: Engine) {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return { root: normalizePath(await $.session.root()), home: normalizePath(home) }
}

function toggleInList(list: string[], value: string, isOn: boolean) {
  const rest = list.filter(v => v !== value)
  return isOn ? rest : [...rest, value]
}

// ── 패널 휴지통 목록 ($.store 에 폴더별로 저장) ───────────
// key:   "trash:<세션 루트>"
// value: TrashedHarness[]

async function readTrashList($: Engine, root: string) {
  return ((await $.store.get(`trash:${root}`)) as TrashedHarness[] | undefined) ?? []
}

async function writeTrashList($: Engine, root: string, list: TrashedHarness[]) {
  await $.store.set(`trash:${root}`, list)
  await update($, trashAtom, () => list)
}

async function refreshHarnessPanel($: Engine) {
  const { root, home } = await readSessionPaths($)
  const groups = await collectHarnessGroups($, root, home)
  await update($, groupsAtom, () => groups)
  const trash = await readTrashList($, root)
  await update($, trashAtom, () => trash)
}

// ── 켜고 끄기 ──────────────────────────────────────

// 누르자마자 화면부터 바꿈. 파일 저장과 목록 다시 읽기는 그 뒤에 함
async function showChangeImmediately($: Engine, change: (groups: HarnessGroup[]) => HarnessGroup[]) {
  await update($, groupsAtom, change)
  $.ui.invalidate('ui.render')
}

async function setHarnessItemsOn($: Engine, items: HarnessItem[], isOn: boolean) {
  const ids = new Set(items.map(i => i.id))
  await showChangeImmediately($, groups =>
    groups.map(g => ({ ...g, items: g.items.map(i => (ids.has(i.id) ? { ...i, isOn } : i)) })),
  )
  const { root } = await readSessionPaths($)
  const overrides = items.filter(i => i.control === 'skillOverrides')
  if (overrides.length > 0) {
    await editSettingsFile($, localSettingsPath(root), settings => {
      for (const i of overrides) setOrDeleteKey(settings, 'skillOverrides', i.target, isOn ? undefined : 'off')
    })
  }
  const modItems = items.filter(i => i.control !== 'skillOverrides')
  if (modItems.length > 0) {
    const off = await readModOffList($, root)
    for (const i of modItems) {
      if (i.control === 'pluginSkill') off.pluginSkills = toggleInList(off.pluginSkills, i.target, isOn)
      else off.hooks = toggleInList(off.hooks, i.target, isOn)
    }
    await writeModOffList($, root, off)
  }
  await refreshHarnessPanel($)
}

async function setPluginOn($: Engine, group: HarnessGroup, isOn: boolean) {
  await showChangeImmediately($, groups => groups.map(g => (g.id === group.id ? { ...g, isPluginOn: isOn } : g)))
  const { root } = await readSessionPaths($)
  await editSettingsFile($, localSettingsPath(root), settings => {
    setOrDeleteKey(settings, 'enabledPlugins', group.pluginId!, isOn ? true : false)
  })
  $.ui.toast(text.toast.pluginToggled(group.title, isOn))
  await refreshHarnessPanel($)
}

async function setGroupOn($: Engine, group: HarnessGroup, isOn: boolean) {
  if (group.pluginId) return setPluginOn($, group, isOn)
  return setHarnessItemsOn($, group.items, isOn)
}

// ── 이름 클릭: 펼치기, [ 열기 ] ────────────────────────

// 이름을 누르면 그 줄 아래에 [ 열기 ] [ 휴지통으로 이동 ] 이 펼쳐짐. 다시 누르면 접힘
async function toggleItemActions($: Engine, item: HarnessItem) {
  await update($, selectedItemAtom, selected => (selected === item.id ? null : item.id))
  await update($, confirmingTrashAtom, () => null)
}

async function openItemInEditor($: Engine, item: HarnessItem) {
  if (!item.filePath) {
    $.ui.toast(text.toast.noFileToOpen(item.label))
    return
  }
  try {
    await openFileInEditor($, item.filePath)
  } catch (error) {
    $.ui.toast(text.toast.openFailed((error as Error).message))
  }
}

// ── 휴지통 ─────────────────────────────────────────

async function moveItemToTrash($: Engine, item: HarnessItem) {
  const { root, home } = await readSessionPaths($)
  try {
    const trashed = await moveHarnessToTrash($, item, home)
    await writeTrashList($, root, [trashed, ...(await readTrashList($, root)).filter(t => t.id !== trashed.id)])
    if (item.kind === 'skill') await forgetSeenSkill($, root, item.target)
    await showChangeImmediately($, groups => groups.map(g => ({ ...g, items: g.items.filter(i => i.id !== item.id) })))
    $.ui.toast(text.toast.movedToTrash(item.label))
  } catch (error) {
    $.ui.toast(text.toast.trashFailed((error as Error).message))
  }
  await update($, selectedItemAtom, () => null)
  await update($, confirmingTrashAtom, () => null)
  await refreshHarnessPanel($)
}

async function restoreTrashedItem($: Engine, trashed: TrashedHarness) {
  const { root, home } = await readSessionPaths($)
  try {
    await restoreHarnessFromTrash($, trashed, home)
    await writeTrashList($, root, (await readTrashList($, root)).filter(t => t.id !== trashed.id))
    $.ui.toast(text.toast.restored(trashed.label))
  } catch (error) {
    $.ui.toast(text.toast.restoreFailed((error as Error).message))
  }
  await refreshHarnessPanel($)
}

// ── 꺼 둔 것 막기 ──────────────────────────────────

// 이 폴더에서 돌 수 있는 settings 훅 전부 (내 settings 파일 3개 + 켜진 플러그인의 hooks.json)
async function collectHookRuns($: Engine, root: string, home: string): Promise<HookRun[]> {
  const sources: { hooks: HookSettings | undefined; pluginRoot?: string }[] = []
  const userFile = (await readJsonFile($, userSettingsPath(home))) ?? {}
  const projectFile = (await readJsonFile($, projectSettingsPath(root))) ?? {}
  const localFile = (await readJsonFile($, localSettingsPath(root))) ?? {}
  sources.push({ hooks: projectFile.hooks }, { hooks: localFile.hooks }, { hooks: userFile.hooks })
  const enabledPlugins: Record<string, boolean> = {
    ...userFile.enabledPlugins,
    ...projectFile.enabledPlugins,
    ...localFile.enabledPlugins,
  }
  for (const p of await collectInstalledPlugins($, home, root)) {
    if (enabledPlugins[p.id] !== true) continue
    const file = await readJsonFile($, `${p.installPath}/hooks/hooks.json`)
    sources.push({ hooks: (file?.hooks ?? file) as HookSettings, pluginRoot: p.installPath })
  }
  const runs: HookRun[] = []
  for (const source of sources) {
    for (const [event, entries] of Object.entries(source.hooks ?? {})) {
      for (const entry of entries ?? []) {
        const matcher = entry.matcher ?? ''
        for (const hook of entry.hooks ?? []) {
          const command = String(hook.command ?? '')
          runs.push({
            target: hookTarget(event, matcher, command),
            event,
            matcher,
            command,
            type: String(hook.type ?? 'command'),
            timeoutSeconds: typeof hook.timeout === 'number' ? hook.timeout : undefined,
            pluginRoot: source.pluginRoot,
          })
        }
      }
    }
  }
  return runs
}

// 꺼 둔 훅이 "<이벤트>|<matcher>" 로 저장돼 있으면 (예전 방식) 그 묶음 전체가 꺼진 것으로 봄
function isHookRunOff(run: HookRun, offHooks: string[]) {
  return offHooks.includes(run.target) || offHooks.includes(`${run.event}|${run.matcher}`)
}

async function runOneHook($: Engine, run: HookRun, stdin: string, root: string): Promise<HookOutcome> {
  const platform = await detectPlatform($)
  const nativeRoot = toNativePath(platform, root)
  const env: Record<string, string> = { CLAUDE_PROJECT_DIR: nativeRoot }
  if (run.pluginRoot) env.CLAUDE_PLUGIN_ROOT = toNativePath(platform, run.pluginRoot)
  const argv = platform === 'windows' ? ['bash', '-c', run.command] : ['sh', '-c', run.command]
  try {
    const result = await $.process.run(argv, { cwd: nativeRoot, env, stdin, timeoutMs: (run.timeoutSeconds ?? 60) * 1000 })
    return readHookOutcome(run.event, result.exitCode, result.stdout, result.stderr)
  } catch {
    return {}
  }
}

// 이 이벤트에서 꺼 둔 훅이 하나라도 걸리면, 켜진 훅만 직접 돌리고 그 결과를 돌려줌
// 꺼 둔 훅이 걸리지 않으면 undefined. 그때는 Claude Code 가 원래대로 돌림
async function runHooksExceptOff($: Engine, event: string, input: Record<string, unknown>) {
  const { root, home } = await readSessionPaths($)
  const off = await readModOffList($, root)
  if (!off.hooks.some(key => key.startsWith(`${event}|`))) return undefined

  const matcherValue = resolveMatcherValue(input)
  const matched = (await collectHookRuns($, root, home)).filter(
    run => run.event === event && isMatchedByHookMatcher(run.matcher, matcherValue),
  )
  if (!matched.some(run => isHookRunOff(run, off.hooks))) return undefined

  const stdin = JSON.stringify(input)
  const enabled = matched.filter(run => !isHookRunOff(run, off.hooks) && run.type === 'command')
  const outcomes = await Promise.all(enabled.map(run => runOneHook($, run, stdin, root)))
  return mergeHookOutcomes(event, outcomes)
}

// PreToolUse 는 엔진이 도구 호출 모양(tool, 인자들)으로 줌. settings 훅이 stdin 으로 받는 모양으로 바꿈
async function buildPreToolUseHookInput($: Engine, envelope: Record<string, unknown>) {
  const { tool, tool_use_id, agentId, consent, ...toolInput } = envelope
  return {
    session_id: await $.session.id(),
    transcript_path: '',
    cwd: (await readSessionPaths($)).root,
    hook_event_name: 'PreToolUse',
    tool_name: String(tool),
    tool_input: toolInput,
    tool_use_id,
  }
}

async function isPluginSkillOff($: Engine, name: string) {
  const off = await readModOffList($, (await readSessionPaths($)).root)
  return off.pluginSkills.some(s => s === name || s.endsWith(`:${name}`))
}

// ── 그리기 ─────────────────────────────────────────

function cutToWidth(text: string, width: number) {
  return text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text
}

// 켜고 끄는 버튼. 터미널에서 [  ON ] 처럼 괄호 친 버튼으로 그려짐
// 켜짐은 강조색, 꺼짐은 흐리게. 섹션 안에서 일부만 켜져 있으면 mixed. 글자는 언어팩의 switch
type SwitchState = 'on' | 'off' | 'mixed'

function resolveGroupSwitchState(group: HarnessGroup): SwitchState {
  if (group.pluginId) return group.isPluginOn ? 'on' : 'off'
  const on = group.items.filter(i => i.isOn).length
  return on === group.items.length ? 'on' : on === 0 ? 'off' : 'mixed'
}

export const register: Register = (on, options) => {
  text = resolveMessages(options.language)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'harness', description: text.command.description })
    await refreshHarnessPanel($)
    void $.ui.open({ id: PANE, title: text.panelTitle, columns: PANE_COLUMNS })
    return next(e)
  })

  // /resume·/clear 로 대화가 바뀌면 패널 상태도 새 대화용으로 비워짐. 그때 바로 다시 채우고 패널을 엶
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await refreshHarnessPanel($)
    void $.ui.open({ id: PANE, title: text.panelTitle, columns: PANE_COLUMNS })
    return result
  })

  on('command.run', { command: 'harness' }, async $ => {
    await refreshHarnessPanel($)
    await $.ui.open({ id: PANE, title: text.panelTitle, columns: PANE_COLUMNS })
    return { text: text.command.opened }
  })

  // /skills 나 settings 파일을 직접 고친 것도 따라가도록 턴이 끝날 때마다 다시 읽음
  on('turn.complete', async ($, e, next) => {
    await refreshHarnessPanel($)
    return next(e)
  })

  // 꺼 둔 플러그인 스킬: 모델의 Skill 호출을 막음
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    if (await isPluginSkillOff($, e.skill)) {
      return { deny: text.model.skillOff(e.skill) }
    }
    return next(e)
  })

  // 꺼 둔 플러그인 스킬: /이름 으로 직접 부를 때도 내용 대신 안내를 보냄
  on('skill.prompt', async ($, e, next) => {
    if (await isPluginSkillOff($, e.skill)) {
      return { text: text.model.skillOff(e.skill) }
    }
    return next(e)
  })

  // 꺼 둔 훅: 그 이벤트에 꺼 둔 훅이 걸리면 켜진 훅만 패널이 직접 돌림. 아니면 Claude Code 가 원래대로 돌림
  on('classic.PreToolUse', async ($, e, next) => {
    const input = await buildPreToolUseHookInput($, e as unknown as Record<string, unknown>)
    const result = await runHooksExceptOff($, 'PreToolUse', input)
    return result ? (result as never) : next(e)
  })
  on('classic.*', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const event = input.hook_event_name
    if (typeof event !== 'string' || event === 'PreToolUse') return next(e)
    const result = await runHooksExceptOff($, event, input)
    return result ? (result as never) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const groups = await read($, groupsAtom)
    const openGroups = await read($, openGroupsAtom)
    const selectedItem = await read($, selectedItemAtom)
    const confirmingTrash = await read($, confirmingTrashAtom)
    const trash = await read($, trashAtom)
    const width = e.props.bodyColumns
    const all = groups.flatMap(g => g.items)
    const onCount = all.filter(i => i.isOn).length

    const jumpToGroup = (groupId: string) => $.ui.scroll({ to: { key: `g-${groupId}` }, in: PANE, block: 'start' })
    const toggleGroupOpen = (groupId: string) =>
      update($, openGroupsAtom, open => ({ ...open, [groupId]: !open[groupId] }))

    // 이름을 누르면 그 줄 아래에 펼쳐지는 부분: 경로 + [ 열기 ] [ 휴지통으로 이동 ]
    //   열기:            강조색(주황)
    //   휴지통으로 이동: 마우스를 올리면 빨강
    //   버튼은 평소 글자색을 바꿀 수 없음. 빨간 글자를 위에 겹쳐 그리면 클릭이 버튼까지 안 가서, 올렸을 때만 빨갛게 함
    const renderRedButton = (key: string, label: string, onPress: () => unknown) => (
      <Button key={key} label={label} hover={{ scope: 'harness-trash', color: 'error' }} onPress={onPress} />
    )
    const renderItemActions = (item: HarnessItem) => (
      // 펼친 부분: 위치 / 실행 시점 / 버튼 을 구분선으로 나눠 보여줌
      //   위치: <파일 경로>
      //   ────
      //   실행 시점: <언제 도는지>    (훅만)
      //   ────
      //   [ 열기 ] [ 휴지통으로 이동 ]
      <Box key={`actions-${item.id}`} flexDirection="column" paddingLeft={4}>
        {item.displayPath && (
          <Text>
            <Text dimColor>{text.location}: </Text>
            {cutToWidth(item.displayPath, width - 12)}
          </Text>
        )}
        {item.displayPath && <Text dimColor>{'─'.repeat(Math.max(1, width - 6))}</Text>}
        {item.detail && (
          <Text>
            <Text dimColor>{text.runsAt}: </Text>
            {item.detail}
          </Text>
        )}
        {item.detail && <Text dimColor>{'─'.repeat(Math.max(1, width - 6))}</Text>}
        {confirmingTrash === item.id ? (
          <Box columnGap={1}>
            <Text color="error">{text.confirmTrash}</Text>
            {renderRedButton(`trash-yes-${item.id}`, text.confirmMove, () => moveItemToTrash($, item))}
            <Button key={`trash-no-${item.id}`} label={text.cancel} onPress={() => update($, confirmingTrashAtom, () => null)} />
          </Box>
        ) : (
          <Box columnGap={1}>
            {item.filePath && (
              <Button key={`open-${item.id}`} variant="primary" label={text.open} onPress={() => openItemInEditor($, item)} />
            )}
            {item.trashable &&
              renderRedButton(`trash-${item.id}`, text.moveToTrash, () => update($, confirmingTrashAtom, () => item.id))}
          </Box>
        )}
        {!item.trashable && item.untrashableReason && <Text dimColor>{item.untrashableReason}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {/* 헤더: 패널 이름 + 닫기 */}
        <Box>
          <Text bold>{text.panelTitle}</Text>
          <Box flexGrow={1} />
          <Button key="close-pane" role="dismiss" label={text.close} onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {/* 섹션 이동 탭 */}
        <Box flexWrap="wrap" columnGap={2} marginTop={1}>
          {groups.slice(0, 9).map((g, i) => (
            <Button key={`tab-${g.id}`} plain hotkey={String(i + 1)} label={g.tab} onPress={() => jumpToGroup(g.id)} />
          ))}
        </Box>
        <Text dimColor>{'─'.repeat(Math.max(1, width))}</Text>
        {/* 목록 시작 전 요약: 전체 켜진 개수 */}
        <Text dimColor>{text.summary(all.length, onCount)}</Text>
        {groups.map(g => {
          const isOpen = !!openGroups[g.id]
          const groupOn = g.items.filter(i => i.isOn).length
          const isDimmed = g.pluginId !== undefined && !g.isPluginOn
          const groupSwitch = resolveGroupSwitchState(g)
          return (
            <Box key={`g-${g.id}`} flexDirection="column" marginTop={1}>
              <Box>
                <Button
                  key={`fold-${g.id}`}
                  plain
                  label={`${g.items.length === 0 ? ' ' : isOpen ? '▾' : '▸'} ${cutToWidth(g.title, width - 30)}`}
                  onPress={() => toggleGroupOpen(g.id)}
                />
                <Text dimColor> {g.where}</Text>
                <Box flexGrow={1} />
                {g.items.length > 0 && <Text dimColor>{groupOn}/{g.items.length} </Text>}
                <Button
                  key={`all-${g.id}`}
                  variant={groupSwitch === 'off' ? undefined : 'primary'}
                  dimColor={groupSwitch === 'off'}
                  label={text.switch[groupSwitch]}
                  onPress={() => setGroupOn($, g, groupSwitch !== 'on')}
                />
              </Box>
              {isOpen &&
                g.items.map(item => (
                  <Box key={`row-${item.id}`} flexDirection="column">
                    <Box paddingLeft={2}>
                      <Button
                        key={`name-${item.id}`}
                        plain
                        dimColor={!item.isOn || isDimmed}
                        label={`${selectedItem === item.id ? '▾ ' : ''}${cutToWidth(item.label, width - 20)}`}
                        onPress={() => toggleItemActions($, item)}
                      />
                      <Box flexGrow={1} />
                      <Text dimColor>{text.kind[item.kind]} </Text>
                      <Button
                        key={`switch-${item.id}`}
                        variant={item.isOn ? 'primary' : undefined}
                        dimColor={!item.isOn || isDimmed}
                        label={text.switch[item.isOn ? 'on' : 'off']}
                        onPress={() => setHarnessItemsOn($, [item], !item.isOn)}
                      />
                    </Box>
                    {selectedItem === item.id && renderItemActions(item)}
                  </Box>
                ))}
            </Box>
          )
        })}
        {trash.length > 0 && (
          <Box key="g-trash" flexDirection="column" marginTop={1}>
            <Box>
              <Button
                key="fold-trash"
                plain
                label={`${openGroups.trash ? '▾' : '▸'} ${text.trash}`}
                onPress={() => toggleGroupOpen('trash')}
              />
              <Box flexGrow={1} />
              <Text dimColor>{trash.length}</Text>
            </Box>
            {openGroups.trash &&
              trash.map(t => (
                <Box key={`trash-row-${t.id}`} paddingLeft={2}>
                  <Text dimColor>{cutToWidth(t.label, width - 22)}</Text>
                  <Box flexGrow={1} />
                  <Text dimColor>{text.kind[t.kind]} </Text>
                  <Button key={`restore-${t.id}`} label={text.restore} onPress={() => restoreTrashedItem($, t)} />
                </Box>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}
