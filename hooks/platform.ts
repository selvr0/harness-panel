// 운영체제마다 다른 명령을 만듦. 실행은 register.tsx 가 함 ($.process.run)
// 경로는 패널 안에서는 모두 "/" 로 다루고, 명령에 넣을 때만 운영체제 형식으로 바꿈

export type Platform = 'mac' | 'windows' | 'linux'

// 윈도우 경로의 "\" 를 "/" 로 바꿈
export function normalizePath(path: string) {
  return path.replace(/\\/g, '/')
}

// 윈도우 명령에 넣을 경로: "/" 를 다시 "\" 로 바꿈
export function toNativePath(platform: Platform, path: string) {
  return platform === 'windows' ? path.replace(/\//g, '\\') : path
}

export function isAbsolutePath(path: string) {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

export function basename(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() ?? path
}

export function dirname(path: string) {
  return path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
}

function quoteForAppleScript(text: string) {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function quoteForPowerShell(text: string) {
  return `'${text.replace(/'/g, "''")}'`
}

function powerShell(script: string) {
  return ['powershell', '-NoProfile', '-NonInteractive', '-Command', script]
}

// ── 에디터로 열기 ──────────────────────────────────
// 차례로 시도해서 처음 성공한 것으로 엶
//   맥:     VS Code → Cursor → Zed → Sublime Text → 기본 텍스트 편집기
//   윈도우: VS Code → Cursor → 메모장
//   리눅스: VS Code → Cursor → Zed → Sublime Text → 기본 앱(xdg-open)

const MAC_EDITOR_APPS = ['Visual Studio Code', 'Cursor', 'Zed', 'Sublime Text']
const LINUX_EDITOR_COMMANDS = ['code', 'cursor', 'zed', 'subl']

export function buildOpenInEditorCommands(platform: Platform, path: string): string[][] {
  if (platform === 'mac') return [...MAC_EDITOR_APPS.map(app => ['open', '-a', app, path]), ['open', '-t', path]]
  if (platform === 'windows') {
    const native = toNativePath(platform, path)
    return [['cmd', '/c', 'code', native], ['cmd', '/c', 'cursor', native], ['notepad', native]]
  }
  return [...LINUX_EDITOR_COMMANDS.map(cmd => [cmd, path]), ['xdg-open', path]]
}

// ── 휴지통으로 옮기기 ──────────────────────────────
//   맥:     Finder 휴지통. 성공하면 휴지통 안의 경로를 stdout 으로 줌 ("되돌려 놓기"도 됨)
//   윈도우: 휴지통(Recycle Bin)
//   리눅스: gio trash → trash-put. 둘 다 없으면 register.tsx 가 ~/.local/share/Trash 로 직접 옮김

export function buildMoveToTrashCommands(platform: Platform, path: string): string[][] {
  if (platform === 'mac') {
    const script = [
      `tell application "Finder" to set trashed to delete (POSIX file ${quoteForAppleScript(path)})`,
      'return POSIX path of (trashed as alias)',
    ].join('\n')
    return [['osascript', '-e', script]]
  }
  if (platform === 'windows') {
    const native = quoteForPowerShell(toNativePath(platform, path))
    return [
      powerShell(
        [
          'Add-Type -AssemblyName Microsoft.VisualBasic',
          `$p = ${native}`,
          "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
          "else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
        ].join('; '),
      ),
    ]
  }
  return [['gio', 'trash', path], ['trash-put', path]]
}

// 윈도우 휴지통에서 원래 경로가 같은 항목을 찾아 원래 자리로 옮김. 못 찾으면 exit 3
export function buildWindowsRestoreCommand(originalPath: string): string[] {
  const native = toNativePath('windows', originalPath)
  return powerShell(
    [
      `$orig = ${quoteForPowerShell(native)}`,
      '$from = Split-Path -LiteralPath $orig -Parent',
      '$leaf = Split-Path -LiteralPath $orig -Leaf',
      '$stem = [System.IO.Path]::GetFileNameWithoutExtension($leaf)',
      '$bin = (New-Object -ComObject Shell.Application).Namespace(10)',
      "$item = $bin.Items() | Where-Object { $_.ExtendedProperty('System.Recycle.DeletedFrom') -ieq $from -and ($_.Name -ieq $leaf -or $_.Name -ieq $stem) } | Select-Object -First 1",
      'if (-not $item) { exit 3 }',
      'Move-Item -LiteralPath $item.Path -Destination $orig',
    ].join('; '),
  )
}

// ── 옮기기·폴더 만들기 (되돌릴 때 씀) ───────────────

export function buildMoveCommand(platform: Platform, from: string, to: string): string[] {
  if (platform === 'windows') {
    return powerShell(
      `Move-Item -LiteralPath ${quoteForPowerShell(toNativePath(platform, from))} -Destination ${quoteForPowerShell(toNativePath(platform, to))}`,
    )
  }
  return ['mv', from, to]
}

export function buildMakeDirCommand(platform: Platform, dir: string): string[] {
  if (platform === 'windows') {
    return powerShell(`New-Item -ItemType Directory -Force -Path ${quoteForPowerShell(toNativePath(platform, dir))} | Out-Null`)
  }
  return ['mkdir', '-p', dir]
}

export function buildRemoveFileCommand(platform: Platform, path: string): string[] {
  if (platform === 'windows') return powerShell(`Remove-Item -LiteralPath ${quoteForPowerShell(toNativePath(platform, path))}`)
  return ['rm', '-f', path]
}

// ── 리눅스 휴지통 (freedesktop 규칙) ────────────────
// ~/.local/share/Trash/files/<이름>        옮겨진 파일
// ~/.local/share/Trash/info/<이름>.trashinfo 원래 경로
//   [Trash Info]
//   Path=<원래 경로>
//   DeletionDate=2026-10-06T18:00:00

export function linuxTrashDirs(home: string) {
  return { files: `${home}/.local/share/Trash/files`, info: `${home}/.local/share/Trash/info` }
}

export function buildTrashInfo(originalPath: string, deletedAt: Date) {
  const date = deletedAt.toISOString().slice(0, 19)
  const encoded = originalPath.split('/').map(encodeURIComponent).join('/')
  return `[Trash Info]\nPath=${encoded}\nDeletionDate=${date}\n`
}

export function readTrashInfoPath(text: string): string | undefined {
  const line = text.split('\n').find(l => l.startsWith('Path='))
  if (!line) return undefined
  try {
    return decodeURIComponent(line.slice('Path='.length).trim())
  } catch {
    return line.slice('Path='.length).trim()
  }
}
