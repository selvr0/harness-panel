import { expect, test } from 'claude-code/testing'

import { mountHarnessPane, setUpEngine } from './fixture'

// 스킬 review 를 휴지통으로 옮겼다가 휴지통 섹션에서 되돌림
async function trashAndRestoreReview(ui: any) {
  await ui.press({ key: 'name-skill:review' })
  await ui.press({ key: 'trash-skill:review' })
  await ui.press({ key: 'trash-yes-skill:review' })
  await ui.press({ key: 'fold-trash' })
  await ui.press({ key: 'restore-skill:review' })
}

test('윈도우: 휴지통(Recycle Bin)으로 옮기고 되돌림, 에디터는 VS Code 부터 시도', async ($, on) => {
  const { files, commands, root } = setUpEngine(on, 'windows')
  const ui = await mountHarnessPane($)

  await ui.press({ key: 'name-skill:review' })
  await ui.press({ key: 'open-skill:review' })
  expect(commands.some(c => c.join(' ') === `cmd /c code ${root.replace(/\//g, '\\')}\\.claude\\skills\\review\\SKILL.md`)).toBe(true)
  await ui.press({ key: 'name-skill:review' })

  await trashAndRestoreReview(ui)
  expect(commands.some(c => c[0] === 'powershell' && c[4]!.includes('SendToRecycleBin'))).toBe(true)
  expect(commands.some(c => c[0] === 'powershell' && c[4]!.includes('Namespace(10)'))).toBe(true)
  expect(files.has(`${root}/.claude/skills/review/SKILL.md`)).toBe(true)
})

test('리눅스: gio trash 로 옮기고, 휴지통 info 파일로 찾아서 되돌림', async ($, on) => {
  const { files, commands, home, root } = setUpEngine(on, 'linux', { linuxTrashTool: true })
  const ui = await mountHarnessPane($)

  await trashAndRestoreReview(ui)
  expect(commands.some(c => c[0] === 'gio' && c[1] === 'trash')).toBe(true)
  expect(files.has(`${root}/.claude/skills/review/SKILL.md`)).toBe(true)
  expect(files.has(`${home}/.local/share/Trash/info/review.trashinfo`)).toBe(false)
})

test('리눅스: gio·trash-put 이 없으면 ~/.local/share/Trash 로 직접 옮기고 되돌림', async ($, on) => {
  const { files, home, root } = setUpEngine(on, 'linux')
  const ui = await mountHarnessPane($)

  await ui.press({ key: 'name-skill:review' })
  await ui.press({ key: 'trash-skill:review' })
  await ui.press({ key: 'trash-yes-skill:review' })
  const infoFiles = [...files.keys()].filter(k => k.startsWith(`${home}/.local/share/Trash/info/`))
  expect(infoFiles.length).toBe(1)
  expect(files.get(infoFiles[0]!)).toContain(`Path=${root}/.claude/skills/review`)

  await ui.press({ key: 'fold-trash' })
  await ui.press({ key: 'restore-skill:review' })
  expect(files.has(`${root}/.claude/skills/review/SKILL.md`)).toBe(true)
})

test('언어: 기본은 영어', async ($, on) => {
  setUpEngine(on)
  const ui = await mountHarnessPane($)
  expect((await ui.find({ key: 'close-pane' }))?.text).toContain('Close')
})

test('언어: language 를 ko 로 두면 한국어', { options: { language: 'ko' } }, async ($, on) => {
  setUpEngine(on)
  const ui = await mountHarnessPane($)
  expect((await ui.find({ key: 'close-pane' }))?.text).toContain('닫기')
})
