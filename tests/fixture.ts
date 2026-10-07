import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

// 테스트용 운영체제 설정
//   root: 세션을 연 디렉토리, home: 홈 디렉토리 (둘 다 "/" 로 씀. 윈도우는 플러그인이 받는 값만 "\" 로 바꿔 줌)
export type FixturePlatform = 'mac' | 'windows' | 'linux'

export const HOOK_COMMAND = 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/check-prompt.py"'

export function describeFixturePaths(platform: FixturePlatform) {
  const home = platform === 'windows' ? 'C:/Users/example' : platform === 'linux' ? '/home/example' : '/Users/example'
  const root = `${home}/project`
  return { home, root, settings: `${root}/.claude/settings.json` }
}

// 엔진 아래를 메모리로 대신함
//   files:    경로 → 내용. 쓴 내용이 다음 읽기에 바로 보임. 폴더는 그 아래 파일이 있으면 있는 것으로 봄
//   commands: process.run 으로 실행된 명령들. 휴지통·mv 명령은 files 안에서 실제로 옮겨 줌
//   options.linuxTrashTool: 리눅스에서 gio trash 가 성공할지 (false 면 직접 옮기는 길로 감)
//   options.settings:       .claude/settings.json 내용을 바꿀 때
//   options.hookResults:    훅 command → 그 훅을 돌렸을 때의 결과 (없으면 종료 코드 0)
//   options.store:          패널 저장소에 미리 넣어 둘 값
export type FixtureOptions = {
  linuxTrashTool?: boolean
  settings?: Record<string, unknown>
  hookResults?: Record<string, { exitCode: number; stdout?: string; stderr?: string }>
  store?: Record<string, unknown>
}

export function setUpEngine(on: On, platform: FixturePlatform = 'mac', options: FixtureOptions = {}) {
  const { home, root, settings } = describeFixturePaths(platform)
  // 맥에서 테스트를 돌리면 엔진이 "C:/..." 를 상대 경로로 보고 앞에 현재 폴더를 붙임. 그 부분을 떼어 냄
  const toFixturePath = (p: string) => p.replace(/\\/g, '/').replace(/^.*?(?=[A-Za-z]:\/)/, '')
  const files = new Map<string, string>([
    [`${root}/.claude/skills/review/SKILL.md`, '# review'],
    [`${root}/.claude/hooks/check-prompt.py`, 'print(1)'],
    [settings, JSON.stringify(options.settings ?? { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }] } })],
  ])
  const commands: string[][] = []
  // 윈도우 휴지통 흉내: 원래 경로 → 휴지통 안 경로
  const windowsRecycleBin = new Map<string, string>()

  const exists = (path: string) => files.has(path) || [...files.keys()].some(k => k.startsWith(`${path}/`))
  const move = (from: string, to: string) => {
    for (const [k, v] of [...files]) {
      if (k === from || k.startsWith(`${from}/`)) {
        files.delete(k)
        files.set(to + k.slice(from.length), v)
      }
    }
  }
  const quoted = (script: string, name: string) => toFixturePath(new RegExp(`\\$${name} = '([^']+)'`).exec(script)?.[1] ?? '')

  on('session.root', () => ({ value: platform === 'windows' ? root.replace(/\//g, '\\') : root }))
  mock.env(
    on,
    platform === 'windows' ? { OS: 'Windows_NT', USERPROFILE: home.replace(/\//g, '\\') } : { HOME: home },
  )
  mock.store(on, options.store ?? {})
  on('session.id', () => ({ value: 'test-session' }) as never)
  mock.clock(on)
  const existsCalls: string[] = []
  on('fs.exists', (_$, e) => {
    const path = toFixturePath((e as { path: string }).path)
    existsCalls.push(path)
    return { value: exists(path) } as never
  })
  on('fs.read', (_$, e) => ({ value: files.get(toFixturePath((e as { path: string }).path)) ?? '' }) as never)
  on('fs.list', (_$, e) => {
    const dir = toFixturePath((e as { path: string }).path)
    const names = new Set<string>()
    for (const k of files.keys()) if (k.startsWith(`${dir}/`)) names.add(k.slice(dir.length + 1).split('/')[0]!)
    return { value: [...names].map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0 })) } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    files.set(toFixturePath(path), text)
    return { value: undefined } as never
  })
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    commands.push(argv)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    const fail = () => ({ value: { exitCode: 1, stdout: '', stderr: 'not found' } }) as never

    if ((argv[0] === 'sh' || argv[0] === 'bash') && argv[1] === '-c') {
      const r = options.hookResults?.[argv[2]!]
      return { value: { exitCode: r?.exitCode ?? 0, stdout: r?.stdout ?? '', stderr: r?.stderr ?? '' } } as never
    }
    if (argv[0] === 'uname') return ok(platform === 'mac' ? 'Darwin\n' : 'Linux\n')
    if (argv[0] === 'osascript') {
      const path = /POSIX file "([^"]+)"/.exec(argv[2] ?? '')?.[1] ?? ''
      const trashed = `${home}/.Trash/${path.split('/').pop()}`
      move(path, trashed)
      return ok(trashed)
    }
    if (argv[0] === 'gio') {
      if (!options.linuxTrashTool) return fail()
      const path = argv[2]!
      const name = path.split('/').pop()!
      move(path, `${home}/.local/share/Trash/files/${name}`)
      files.set(`${home}/.local/share/Trash/info/${name}.trashinfo`, `[Trash Info]\nPath=${path}\n`)
      return ok()
    }
    if (argv[0] === 'trash-put') return fail()
    if (argv[0] === 'mv') {
      move(argv[1]!, argv[2]!)
      return ok()
    }
    if (argv[0] === 'rm') {
      files.delete(argv[2]!)
      return ok()
    }
    if (argv[0] === 'powershell') {
      const script = argv[4] ?? ''
      if (script.includes('SendToRecycleBin')) {
        const path = quoted(script, 'p')
        const trashed = `C:/$Recycle.Bin/${path.split('/').pop()}`
        windowsRecycleBin.set(path, trashed)
        move(path, trashed)
      } else if (script.includes('Namespace(10)')) {
        const orig = quoted(script, 'orig')
        const trashed = windowsRecycleBin.get(orig)
        if (!trashed) return { value: { exitCode: 3, stdout: '', stderr: '' } } as never
        move(trashed, orig)
      }
      return ok()
    }
    return ok()
  })
  on('settings.read', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        breakdown: {
          skills: {
            totalSkills: 1,
            includedSkills: 1,
            skillFrontmatter: [{ name: 'review', source: 'projectSettings', tokens: 10 }],
          },
        },
      },
    },
  }) as never)
  return { files, commands, home, root, settings, existsCalls }
}

export async function mountHarnessPane($: any) {
  await $.command.run({ command: 'harness', args: '' })
  return $.ui.mount({
    plugin: 'harness-panel',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'harness',
    props: { title: 'Harness Panel', isFocused: true, bodyColumns: 50, placement: 'dock' },
  })
}
