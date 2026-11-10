import { expect, test } from 'claude-code/testing'

import { mountHarnessPane, setUpEngine } from './fixture'

const startSession = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

// fixture 가 답하지 않는, 세션 시작에 필요한 호출에 답함
const answerSessionStart = (on: any) => {
  on('command.register', () => ({ value: { command: 'harness' } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
}

test('저장값이 없으면 지금처럼 세션 시작 때 패널을 엶', async ($, on) => {
  const { openedPanes } = setUpEngine(on)
  answerSessionStart(on)

  await startSession($)
  expect(openedPanes).toEqual(['harness'])
})

test('버튼으로 끄면 세션 시작 때 패널을 열지 않음', async ($, on) => {
  const { openedPanes, savedStore } = setUpEngine(on)
  answerSessionStart(on)

  const ui = await mountHarnessPane($)
  await ui.press({ key: 'auto-open' })
  expect(savedStore.get('autoOpen')).toBe(false)
  await ui.unmount()

  openedPanes.length = 0
  await startSession($)
  expect(openedPanes).toEqual([])
})
