// settings.json 의 hooks 항목
// {
//   <이벤트>: [
//     { matcher?: <도구 이름>, hooks: [{ type: "command", command: <실행할 명령> }] }
//   ]
// }
export type HookEntry = { matcher?: string; hooks?: Record<string, unknown>[] }
export type HookSettings = Record<string, HookEntry[]>

export function localSettingsPath(root: string) {
  return `${root}/.claude/settings.local.json`
}

export function projectSettingsPath(root: string) {
  return `${root}/.claude/settings.json`
}

export function userSettingsPath(home: string) {
  return `${home}/.claude/settings.json`
}

export function setOrDeleteKey(settings: Record<string, any>, section: string, key: string, value: unknown) {
  const table = { ...(settings[section] ?? {}) }
  if (value === undefined) delete table[key]
  else table[key] = value
  if (Object.keys(table).length === 0) delete settings[section]
  else settings[section] = table
}

// settings 의 hooks 에서 command 가 같은 훅 한 개를 뺌. 비게 된 matcher 묶음·이벤트도 같이 지움
// 반환값: 뺀 훅 객체. 못 찾으면 undefined
export function removeHookFromSettings(
  settings: Record<string, any>,
  event: string,
  matcher: string,
  command: string,
): Record<string, unknown> | undefined {
  const hooks = settings.hooks as HookSettings | undefined
  const entries = hooks?.[event]
  if (!hooks || !entries) return undefined
  for (const entry of entries) {
    if ((entry.matcher ?? '') !== matcher) continue
    const index = (entry.hooks ?? []).findIndex(h => h.command === command)
    if (index < 0) continue
    const [removed] = entry.hooks!.splice(index, 1)
    if (entry.hooks!.length === 0) entries.splice(entries.indexOf(entry), 1)
    if (entries.length === 0) delete hooks[event]
    if (Object.keys(hooks).length === 0) delete settings.hooks
    return removed
  }
  return undefined
}

// 휴지통에서 되돌릴 때 훅 한 개를 원래 이벤트·matcher 자리에 다시 넣음
export function insertHookIntoSettings(
  settings: Record<string, any>,
  event: string,
  matcher: string,
  hook: Record<string, unknown>,
) {
  const hooks = (settings.hooks ??= {}) as HookSettings
  const entries = (hooks[event] ??= [])
  let entry = entries.find(e => (e.matcher ?? '') === matcher)
  if (!entry) {
    entry = matcher ? { matcher, hooks: [] } : { hooks: [] }
    entries.push(entry)
  }
  ;(entry.hooks ??= []).push(hook)
}
