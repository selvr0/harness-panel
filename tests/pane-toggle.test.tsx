import { expect, test } from 'claude-code/testing'

import { HOOK_COMMAND, mountHarnessPane, setUpEngine } from './fixture'

test('토글을 누르면 그 자리에서 바로 바뀜', async ($, on) => {
  setUpEngine(on)
  const ui = await mountHarnessPane($)

  expect((await ui.find({ key: 'switch-skill:review' }))?.text).toContain('ON')
  await ui.press({ key: 'switch-skill:review' })
  expect((await ui.find({ key: 'switch-skill:review' }))?.text).toContain('OFF')
  await ui.press({ key: 'switch-skill:review' })
  expect((await ui.find({ key: 'switch-skill:review' }))?.text).toContain('ON')
})

test('이름을 누르면 [ 열기 ] [ 휴지통으로 이동 ] 이 나오고, 열기를 누르면 에디터로 열림', async ($, on) => {
  const { commands, root } = setUpEngine(on)
  const ui = await mountHarnessPane($)

  await ui.press({ key: 'name-skill:review' })
  expect(await ui.find({ key: 'trash-skill:review' })).toBeDefined()

  await ui.press({ key: 'open-skill:review' })
  expect(commands.some(c => c[0] === 'open' && c.includes(`${root}/.claude/skills/review/SKILL.md`))).toBe(true)

  await ui.press({ key: 'name-skill:review' })
  expect(await ui.find({ key: 'open-skill:review' })).toBeUndefined()
})

test('훅을 휴지통으로 옮기면 settings 에서 빠지고, 되돌리면 다시 들어감', async ($, on) => {
  const { files, home, root, settings } = setUpEngine(on)
  const ui = await mountHarnessPane($)
  const hookId = `hook:project:UserPromptSubmit|:${HOOK_COMMAND}`

  await ui.press({ key: `name-${hookId}` })
  await ui.press({ key: `trash-${hookId}` })
  await ui.press({ key: `trash-yes-${hookId}` })

  expect(JSON.parse(files.get(settings)!).hooks).toBeUndefined()
  expect(files.has(`${root}/.claude/hooks/check-prompt.py`)).toBe(false)
  expect(files.has(`${home}/.Trash/check-prompt.py`)).toBe(true)

  await ui.press({ key: 'fold-trash' })
  await ui.press({ key: `restore-${hookId}` })

  expect(JSON.parse(files.get(settings)!).hooks.UserPromptSubmit[0].hooks[0].command).toBe(HOOK_COMMAND)
  expect(files.has(`${root}/.claude/hooks/check-prompt.py`)).toBe(true)
})

test('스킬을 휴지통으로 옮기면 목록에서 사라짐', async ($, on) => {
  const { files, home } = setUpEngine(on)
  const ui = await mountHarnessPane($)

  await ui.press({ key: 'name-skill:review' })
  await ui.press({ key: 'trash-skill:review' })
  await ui.press({ key: 'trash-yes-skill:review' })

  expect(files.has(`${home}/.Trash/review/SKILL.md`)).toBe(true)
  expect(await ui.find({ key: 'switch-skill:review' })).toBeUndefined()
})

test('/resume 로 대화가 바뀌면 질문 전에도 목록이 바로 보임', async ($, on) => {
  setUpEngine(on)
  // 엔진 쪽 settings 훅 자리. 아무 훅도 없는 상태
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'resume' } as never)
  const ui = await $.ui.mount({
    plugin: 'harness-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'harness',
    props: { title: 'Harness Panel', isFocused: false, bodyColumns: 50, placement: 'dock' } as never,
  })
  expect((await ui.find({ key: 'switch-skill:review' }))?.text).toContain('ON')
})

test('설치 전에 꺼 둔 스킬도 꺼진 채로 보임', async ($, on) => {
  const { files, root } = setUpEngine(on)
  files.set(`${root}/.claude/skills/deploy/SKILL.md`, '# deploy')
  files.set(`${root}/.claude/settings.local.json`, JSON.stringify({ skillOverrides: { deploy: 'off' } }))
  const ui = await mountHarnessPane($)
  expect((await ui.find({ key: 'switch-skill:deploy' }))?.text).toContain('OFF')
})

test('같은 묶음의 훅을 하나만 끄면 그 줄만 OFF 로 바뀜', async ($, on) => {
  setUpEngine(on, 'mac', {
    settings: {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash a.sh' }, { type: 'command', command: 'bash b.sh' }] }],
      },
    },
  })
  const ui = await mountHarnessPane($)
  await ui.press({ key: 'switch-hook:project:PreToolUse|Bash:bash a.sh' })
  expect((await ui.find({ key: 'switch-hook:project:PreToolUse|Bash:bash a.sh' }))?.text).toContain('OFF')
  expect((await ui.find({ key: 'switch-hook:project:PreToolUse|Bash:bash b.sh' }))?.text).toContain('ON')
})
