import { expect, mock, test } from 'claude-code/testing'

import { describeFixturePaths, setUpEngine } from './fixture'

const { root } = describeFixturePaths('mac')
const CHECK_A = 'bash .claude/hooks/check-a.sh'
const CHECK_B = 'bash .claude/hooks/check-b.sh'

// Bash 실행 전에 훅 두 개가 같은 matcher 묶음에 들어 있는 settings
const TWO_BASH_HOOKS = {
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: CHECK_A }, { type: 'command', command: CHECK_B }] }],
  },
}

// 엔진 쪽: Claude Code 가 settings 훅을 직접 돌렸는지 세고, Bash 도구는 그냥 성공시킴
function countEngineHookRuns(on: any) {
  const count = { engine: 0 }
  on('classic.PreToolUse', () => {
    count.engine += 1
    return {}
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  return count
}

function hookCommandsRun(commands: string[][]) {
  return commands.filter(c => c[0] === 'sh' && c[1] === '-c').map(c => c[2])
}

test('같은 묶음의 훅 하나만 끄면, 나머지 훅은 그대로 돎', async ($, on) => {
  const { commands } = setUpEngine(on, 'mac', {
    settings: TWO_BASH_HOOKS,
    store: { [`off:${root}`]: { pluginSkills: [], hooks: [`PreToolUse|Bash|${CHECK_A}`] } },
  })
  const count = countEngineHookRuns(on)

  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(hookCommandsRun(commands)).toEqual([CHECK_B])
  expect(count.engine).toBe(0)
})

test('남은 훅이 막으면(종료 코드 2) 도구 호출이 막힘', async ($, on) => {
  setUpEngine(on, 'mac', {
    settings: TWO_BASH_HOOKS,
    store: { [`off:${root}`]: { pluginSkills: [], hooks: [`PreToolUse|Bash|${CHECK_A}`] } },
    hookResults: { [CHECK_B]: { exitCode: 2, stderr: 'blocked by check-b' } },
  })
  countEngineHookRuns(on)

  const result = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(result.deny ?? (result as any).text).toContain('blocked by check-b')
})

test('꺼 둔 훅이 없으면 Claude Code 가 원래대로 돌림', async ($, on) => {
  const { commands } = setUpEngine(on, 'mac', { settings: TWO_BASH_HOOKS })
  const count = countEngineHookRuns(on)

  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(count.engine).toBe(1)
  expect(hookCommandsRun(commands)).toEqual([])
})

test('예전 방식(묶음 전체)으로 꺼 둔 값은 묶음 안 훅이 모두 꺼진 것으로 봄', async ($, on) => {
  const { commands } = setUpEngine(on, 'mac', {
    settings: TWO_BASH_HOOKS,
    store: { [`off:${root}`]: { pluginSkills: [], hooks: ['PreToolUse|Bash'] } },
  })
  const count = countEngineHookRuns(on)

  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(hookCommandsRun(commands)).toEqual([])
  expect(count.engine).toBe(0)
})

test('꺼 둔 플러그인 스킬만 Skill 호출이 막힘', async ($, on) => {
  on('session.root', () => ({ value: root }))
  mock.env(on, { HOME: '/Users/example' })
  mock.store(on, { [`off:${root}`]: { pluginSkills: ['vercel:nextjs'], hooks: [] } })
  on('fs.exists', () => ({ value: false }) as never)
  on('tool.call', { tool: 'Skill' }, () => ({ result: { success: true, commandName: 'x' } }))

  const blocked = await $.tool.call({ tool: 'Skill', skill: 'vercel:nextjs' })
  expect(blocked.deny).toContain('turned off')

  const passed = await $.tool.call({ tool: 'Skill', skill: 'review' })
  expect(passed.deny).toBeUndefined()
})
