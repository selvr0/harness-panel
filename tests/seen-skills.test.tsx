import { expect, test } from 'claude-code/testing'
import type { ContextSkill, ContextSkills } from 'claude-code'

import { describeFixturePaths, mountHarnessPane, setUpEngine } from './fixture'

const { home, root } = describeFixturePaths('mac')
const SEEN_KEY = `seen-skills:${root}`
const OFF_KEY = `off:${root}`
const DGKIT_ID = 'dgkit@personal-claude-plugin'
const DGKIT_PATH = `${home}/.claude/plugins/cache/dgkit`

function pluginSkill(name: string): ContextSkill {
  return { name: `dgkit:${name}`, source: 'plugin', pluginName: 'dgkit', tokens: 1 }
}

function builtinSkill(name: string): ContextSkill {
  return { name, source: 'built-in', tokens: 1 }
}

function projectSkill(name: string): ContextSkill {
  return { name, source: 'projectSettings', tokens: 1 }
}

// 스킬을 빠짐없이 담은 Claude Code 목록
function completeListing(skills: ContextSkill[]): ContextSkills {
  return { totalSkills: skills.length, includedSkills: skills.length, tokens: 0, skillFrontmatter: skills }
}

// 저장 값에는 tokens 가 없음
function seenEntries(skills: ContextSkill[]) {
  return skills.map(({ name, source, pluginName }) => ({ name, source, pluginName }))
}

// dgkit 플러그인을 설치하고, enabled 값으로 켜 둠·꺼 둠을 정함
function installDgkit(files: Map<string, string>, enabled: boolean) {
  files.set(
    `${home}/.claude/plugins/installed_plugins.json`,
    JSON.stringify({ plugins: { [DGKIT_ID]: [{ scope: 'user', installPath: DGKIT_PATH }] } }),
  )
  files.set(`${root}/.claude/settings.local.json`, JSON.stringify({ enabledPlugins: { [DGKIT_ID]: enabled } }))
}

function readSeenNames(savedStore: Map<string, unknown>) {
  const seen = savedStore.get(SEEN_KEY) as { name: string }[]
  return seen.map(s => s.name).sort()
}

// 세션 시작·턴 끝과 같은 갱신. Claude Code 목록을 지금 상태로 보고 없는 스킬을 지움
async function refreshWithCurrentListing($: any) {
  await $.command.run({ command: 'harness', args: '' })
}

test('플러그인에서 삭제된 스킬은 저장 목록과 패널에서 빠지고, 같은 플러그인의 남은 스킬은 그대로임', async ($, on) => {
  const nested = '제품/GOS/워크스페이스/erp-epsilon:understand-change'
  const { savedStore } = setUpEngine(on, 'mac', {
    store: { [SEEN_KEY]: seenEntries([pluginSkill('understand-change'), pluginSkill('image-capture'), projectSkill(nested)]) },
    readSkillListing: () => completeListing([pluginSkill('image-capture'), projectSkill('review')]),
  })
  const ui = await mountHarnessPane($)

  expect(readSeenNames(savedStore)).toEqual(['dgkit:image-capture', 'review'])
  await ui.press({ key: 'fold-plugin:dgkit' })
  expect(await ui.find({ key: 'switch-skill:dgkit:image-capture' })).toBeDefined()
  expect(await ui.find({ key: 'switch-skill:dgkit:understand-change' })).toBeUndefined()
})

test('패널에서 하나씩 끈 플러그인 스킬은 목록에 없어도 OFF 로 남고, 이름 앞부분이 다른 플러그인 스킬은 빠짐', async ($, on) => {
  const otherPluginSkill = { name: 'other:paused', source: 'plugin', pluginName: 'other', tokens: 1 }
  const { savedStore } = setUpEngine(on, 'mac', {
    store: {
      [SEEN_KEY]: seenEntries([pluginSkill('paused'), pluginSkill('bare-name'), otherPluginSkill]),
      [OFF_KEY]: { pluginSkills: ['dgkit:paused', 'bare-name'], hooks: [] },
    },
    readSkillListing: () => completeListing([pluginSkill('image-capture')]),
  })
  const ui = await mountHarnessPane($)

  expect(readSeenNames(savedStore)).toEqual(['dgkit:bare-name', 'dgkit:image-capture', 'dgkit:paused'])
  await ui.press({ key: 'fold-plugin:dgkit' })
  expect((await ui.find({ key: 'switch-skill:dgkit:paused' }))?.text).toContain('OFF')
})

test('skillOverrides 로 목록에서 빠진 스킬은 남고, 다른 값은 그 스킬을 지켜 주지 않음', async ($, on) => {
  const { files, savedStore } = setUpEngine(on, 'mac', {
    store: {
      [SEEN_KEY]: seenEntries([
        builtinSkill('turned-off'),
        builtinSkill('anthropic-skills:docs'),
        builtinSkill('model-hidden'),
        builtinSkill('name-only-removed'),
        builtinSkill('removed'),
      ]),
    },
    readSkillListing: () => completeListing([projectSkill('review')]),
  })
  files.set(
    `${root}/.claude/settings.local.json`,
    JSON.stringify({
      skillOverrides: {
        'turned-off': 'off',
        docs: 'off',
        'model-hidden': 'user-invocable-only',
        'name-only-removed': 'name-only',
      },
    }),
  )
  const ui = await mountHarnessPane($)

  expect(readSeenNames(savedStore)).toEqual(['anthropic-skills:docs', 'model-hidden', 'review', 'turned-off'])
  await ui.press({ key: 'fold-builtin' })
  expect((await ui.find({ key: 'switch-skill:turned-off' }))?.text).toContain('OFF')
})

test('꺼진 플러그인의 스킬은 전부 목록에서 사라져도 남고, 다시 켜서 읽히면 삭제된 것만 빠짐', async ($, on) => {
  const listed: ContextSkill[] = [projectSkill('review')]
  const { files, savedStore } = setUpEngine(on, 'mac', {
    store: { [SEEN_KEY]: seenEntries([pluginSkill('image-capture'), pluginSkill('understand-change')]) },
    readSkillListing: () => completeListing(listed),
  })
  installDgkit(files, false)
  const ui = await mountHarnessPane($)

  expect(readSeenNames(savedStore)).toEqual(['dgkit:image-capture', 'dgkit:understand-change', 'review'])
  await ui.press({ key: 'fold-plugin:dgkit' })
  expect(await ui.find({ key: 'switch-skill:dgkit:image-capture' })).toBeDefined()

  // 플러그인을 켰지만 /reload-plugins 전이라 Claude Code 목록은 그대로임
  await ui.press({ key: 'all-plugin:dgkit' })
  await refreshWithCurrentListing($)
  expect(readSeenNames(savedStore)).toEqual(['dgkit:image-capture', 'dgkit:understand-change', 'review'])

  // /reload-plugins 뒤: 플러그인 스킬이 목록에 돌아옴
  listed.push(pluginSkill('image-capture'))
  await refreshWithCurrentListing($)
  expect(readSeenNames(savedStore)).toEqual(['dgkit:image-capture', 'review'])
})

const INCOMPLETE_LISTINGS: [string, ContextSkills | undefined][] = [
  ['skills 가 없을 때', undefined],
  ['목록이 비었을 때', { totalSkills: 0, includedSkills: 0, tokens: 0, skillFrontmatter: [] }],
  ['일부만 담겼을 때', { totalSkills: 5, includedSkills: 1, tokens: 0, skillFrontmatter: [projectSkill('review')] }],
]

for (const [situation, listing] of INCOMPLETE_LISTINGS) {
  test(`${situation}는 없는 스킬을 지우지 않음`, async ($, on) => {
    const seen = seenEntries([projectSkill('review'), builtinSkill('simplify')])
    const { savedStore } = setUpEngine(on, 'mac', { store: { [SEEN_KEY]: seen }, readSkillListing: () => listing })
    const ui = await mountHarnessPane($)

    expect(readSeenNames(savedStore)).toEqual(['review', 'simplify'])
    expect(await ui.find({ key: 'switch-skill:review' })).toBeDefined()
  })
}

test('꺼 둔 스킬을 켠 직후 Claude Code 목록이 옛 상태여도 줄이 사라지지 않음', async ($, on) => {
  const listed: ContextSkill[] = [projectSkill('review')]
  const { files, savedStore } = setUpEngine(on, 'mac', {
    store: { [SEEN_KEY]: seenEntries([projectSkill('review'), projectSkill('deploy')]) },
    readSkillListing: () => completeListing(listed),
  })
  files.set(`${root}/.claude/skills/deploy/SKILL.md`, '# deploy')
  files.set(`${root}/.claude/settings.local.json`, JSON.stringify({ skillOverrides: { deploy: 'off' } }))
  const ui = await mountHarnessPane($)
  expect((await ui.find({ key: 'switch-skill:deploy' }))?.text).toContain('OFF')

  await ui.press({ key: 'switch-skill:deploy' })
  expect((await ui.find({ key: 'switch-skill:deploy' }))?.text).toContain('ON')
  expect(readSeenNames(savedStore)).toEqual(['deploy', 'review'])

  listed.push(projectSkill('deploy'))
  await refreshWithCurrentListing($)
  expect((await ui.find({ key: 'switch-skill:deploy' }))?.text).toContain('ON')
})

test('휴지통으로 옮긴 스킬을 되돌리면 켜 둔 스킬은 ON, 꺼 둔 스킬은 OFF 로 다시 보임', async ($, on) => {
  // Claude Code 처럼 파일이 있는 켜진 스킬만 목록에 담음
  let readFiles: Map<string, string>
  const { files } = setUpEngine(on, 'mac', {
    store: { [SEEN_KEY]: seenEntries([projectSkill('review'), projectSkill('deploy')]) },
    readSkillListing: () =>
      completeListing(readFiles.has(`${root}/.claude/skills/review/SKILL.md`) ? [projectSkill('review')] : [builtinSkill('simplify')]),
  })
  readFiles = files
  files.set(`${root}/.claude/skills/deploy/SKILL.md`, '# deploy')
  files.set(`${root}/.claude/settings.local.json`, JSON.stringify({ skillOverrides: { deploy: 'off' } }))
  const ui = await mountHarnessPane($)

  for (const name of ['review', 'deploy']) {
    await ui.press({ key: `name-skill:${name}` })
    await ui.press({ key: `trash-skill:${name}` })
    await ui.press({ key: `trash-yes-skill:${name}` })
    expect(await ui.find({ key: `switch-skill:${name}` })).toBeUndefined()
  }
  await refreshWithCurrentListing($)
  expect(await ui.find({ key: 'switch-skill:deploy' })).toBeUndefined()

  await ui.press({ key: 'fold-trash' })
  await ui.press({ key: 'restore-skill:review' })
  await ui.press({ key: 'restore-skill:deploy' })

  expect((await ui.find({ key: 'switch-skill:review' }))?.text).toContain('ON')
  expect((await ui.find({ key: 'switch-skill:deploy' }))?.text).toContain('OFF')
})
