import { expect, test } from 'claude-code/testing'

import { describeFixturePaths, mountHarnessPane, setUpEngine } from './fixture'

const { root } = describeFixturePaths('mac')
const WEB = `${root}/apps/web`
const HOOK_COMMAND = 'bash .claude/hooks/web-check.sh'
const WEB_SETTINGS = {
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: HOOK_COMMAND }] }] },
}

// apps/web 에 스킬 하나와 훅 하나를 둠
function addWebDirectory(files: Map<string, string>) {
  files.set(`${WEB}/.claude/skills/deploy/SKILL.md`, '# deploy')
  files.set(`${WEB}/.claude/settings.json`, JSON.stringify(WEB_SETTINGS))
}

test('node_modules 와 숨김 폴더 아래 .claude 는 섹션을 만들지 않음', async ($, on) => {
  const { files } = setUpEngine(on)
  addWebDirectory(files)
  files.set(`${root}/node_modules/pkg/.claude/skills/hidden-a/SKILL.md`, '# a')
  files.set(`${root}/.repo.git/worktrees/w/.claude/skills/hidden-b/SKILL.md`, '# b')
  const ui = await mountHarnessPane($)
  expect(await ui.find({ key: 'tab-dir:apps/web' })).toBeDefined()
  expect(await ui.find({ key: 'tab-dir:node_modules/pkg' })).toBeUndefined()
  expect(await ui.find({ key: 'tab-dir:.repo.git/worktrees/w' })).toBeUndefined()
})

test('스킬과 훅이 없는 하위 디렉토리는 섹션을 만들지 않음', async ($, on) => {
  const { files } = setUpEngine(on)
  files.set(`${root}/apps/empty/.claude/settings.json`, '{}')
  const ui = await mountHarnessPane($)
  expect(await ui.find({ key: 'tab-dir:apps/empty' })).toBeUndefined()
})

test('하위 디렉토리 스킬을 끄면 그 디렉토리의 settings.local.json 에만 저장됨', async ($, on) => {
  const { files } = setUpEngine(on)
  addWebDirectory(files)
  const ui = await mountHarnessPane($)
  await ui.press({ key: 'fold-dir:apps/web' })
  await ui.press({ key: 'switch-skill:dir:apps/web:deploy' })
  expect(JSON.parse(files.get(`${WEB}/.claude/settings.local.json`)!).skillOverrides).toEqual({ deploy: 'off' })
  expect(files.has(`${root}/.claude/settings.local.json`)).toBe(false)
})

test('하위 디렉토리 훅을 끄면 그 디렉토리의 꺼 둔 목록에만 저장됨', async ($, on) => {
  const { files, savedStore } = setUpEngine(on)
  addWebDirectory(files)
  const ui = await mountHarnessPane($)
  await ui.press({ key: 'fold-dir:apps/web' })
  await ui.press({ key: `switch-hook:dir:apps/web:project:PreToolUse|Bash:${HOOK_COMMAND}` })
  expect(savedStore.get(`off:${WEB}`)).toEqual({ pluginSkills: [], hooks: [`PreToolUse|Bash|${HOOK_COMMAND}`] })
  expect((savedStore.get(`off:${root}`) as { hooks: string[] } | undefined)?.hooks ?? []).toEqual([])
})

test('루트에 스킬과 훅이 없어도 하위 디렉토리가 있으면 루트 섹션을 보여 줌', async ($, on) => {
  const { files } = setUpEngine(on, 'mac', { settings: {}, readSkillListing: () => undefined })
  files.delete(`${root}/.claude/skills/review/SKILL.md`)
  addWebDirectory(files)
  const ui = await mountHarnessPane($)
  expect(await ui.find({ key: 'g-proj' })).toBeDefined()
  expect(await ui.find({ key: 'all-proj' })).toBeUndefined()
  expect(await ui.find({ key: 'tab-dir:apps/web' })).toBeDefined()
})
