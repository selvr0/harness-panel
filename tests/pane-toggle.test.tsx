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

// iTerm2 Claude Code 연동처럼 확장자 없는 실행 파일 하나를 여러 이벤트에 건 settings
const CC_STATUS = '/Users/example/.config/iterm2/cc-status'
const CC_STATUS_ID = `hook:project:${CC_STATUS}`
const CC_STATUS_ON_THREE_EVENTS = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: CC_STATUS }] }],
    PreToolUse: [{ hooks: [{ type: 'command', command: CC_STATUS }] }],
    Stop: [{ hooks: [{ type: 'command', command: CC_STATUS }] }],
  },
}

test('같은 명령을 여러 이벤트에 건 훅은 실행 파일 이름으로 한 줄만 보임', async ($, on) => {
  setUpEngine(on, 'mac', { settings: CC_STATUS_ON_THREE_EVENTS })
  const ui = await mountHarnessPane($)

  expect((await ui.find({ key: `name-${CC_STATUS_ID}` }))?.text).toContain('cc-status')
  expect(await ui.find({ key: `name-hook:project:UserPromptSubmit|:${CC_STATUS}` })).toBeUndefined()

  await ui.press({ key: `name-${CC_STATUS_ID}` })
  const actions = (await ui.find({ key: `actions-${CC_STATUS_ID}` }))?.text ?? ''
  expect(actions).toContain('When a prompt is sent')
  expect(actions).toContain('Before a tool runs')
})

test('묶인 훅 줄을 끄면 모든 이벤트에서 안 돎', async ($, on) => {
  const { commands } = setUpEngine(on, 'mac', { settings: CC_STATUS_ON_THREE_EVENTS })
  // 패널이 막지 않으면 Claude Code 가 settings 훅을 직접 돌림. 그 횟수를 셈
  const engine = { runs: 0 }
  on('classic.PreToolUse', () => {
    engine.runs += 1
    return {}
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  const ui = await mountHarnessPane($)

  await ui.press({ key: `switch-${CC_STATUS_ID}` })
  expect((await ui.find({ key: `switch-${CC_STATUS_ID}` }))?.text).toContain('OFF')

  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(commands.some(c => c[0] === 'sh' && c[2] === CC_STATUS)).toBe(false)
  expect(engine.runs).toBe(0)

  await ui.press({ key: `switch-${CC_STATUS_ID}` })
  expect((await ui.find({ key: `switch-${CC_STATUS_ID}` }))?.text).toContain('ON')
})

test('묶인 훅 줄을 휴지통으로 옮기면 모든 이벤트에서 빠지고, 되돌리면 모두 다시 들어감', async ($, on) => {
  const { files, settings } = setUpEngine(on, 'mac', { settings: CC_STATUS_ON_THREE_EVENTS })
  const ui = await mountHarnessPane($)

  await ui.press({ key: `name-${CC_STATUS_ID}` })
  await ui.press({ key: `trash-${CC_STATUS_ID}` })
  await ui.press({ key: `trash-yes-${CC_STATUS_ID}` })
  expect(JSON.parse(files.get(settings)!).hooks).toBeUndefined()

  await ui.press({ key: 'fold-trash' })
  await ui.press({ key: `restore-${CC_STATUS_ID}` })
  const restored = JSON.parse(files.get(settings)!).hooks
  expect(Object.keys(restored).sort()).toEqual(['PreToolUse', 'Stop', 'UserPromptSubmit'])
  expect(restored.Stop[0].hooks[0].command).toBe(CC_STATUS)
})

test('같은 종류 안에서는 이름순으로 보임', async ($, on) => {
  setUpEngine(on, 'mac', {
    settings: {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [
              { type: 'command', command: 'bash .claude/hooks/test-plan-gate.sh' },
              { type: 'command', command: 'bash .claude/hooks/code-layer-gate.sh' },
              { type: 'command', command: 'bash .claude/hooks/github-pr-body-check.sh' },
            ],
          },
        ],
      },
    },
  })
  const ui = await mountHarnessPane($)

  const section = (await ui.find({ key: 'g-proj' }))?.text ?? ''
  const order = ['code-layer-gate.sh', 'github-pr-body-check.sh', 'test-plan-gate.sh'].map(name => section.indexOf(name))
  expect(order.every(i => i >= 0)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
})
