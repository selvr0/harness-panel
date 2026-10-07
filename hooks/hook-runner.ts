// 이벤트에 걸린 훅 중 일부만 꺼져 있을 때, 켜진 훅만 패널이 직접 돌리고 결과를 합침
// 여기는 순수 함수만 둠. 실제 실행($.process.run)은 register.tsx 가 함

// 실행할 훅 한 개
export type HookRun = {
  // 켜고 끄는 단위. "<이벤트>|<matcher>|<command>"
  target: string
  event: string
  matcher: string
  command: string
  // 초 단위. 없으면 60초
  timeoutSeconds?: number
  // command 가 아닌 훅(prompt 등)은 패널이 대신 돌릴 수 없음
  type: string
  // 플러그인 훅이면 그 플러그인 폴더 (CLAUDE_PLUGIN_ROOT)
  pluginRoot?: string
}

// 훅 한 개를 돌린 결과를 읽어서 정리한 것
export type HookOutcome = {
  block?: string
  preventContinuation?: true
  stopReason?: string
  additionalContext?: string
  permission?: { decision: 'allow' | 'deny' | 'ask'; reason?: string }
  updatedInput?: Record<string, unknown>
}

export function hookTarget(event: string, matcher: string, command: string) {
  return `${event}|${matcher}|${command}`
}

// matcher 가 이 값(도구 이름, SessionStart 의 source 등)에 걸리는지. 값이 없으면 matcher 를 따지지 않음
export function isMatchedByHookMatcher(matcher: string, value: string | undefined) {
  if (value === undefined || !matcher || matcher === '*') return true
  try {
    return new RegExp(`^(?:${matcher})$`).test(value)
  } catch {
    return matcher === value
  }
}

// 이벤트 입력에서 matcher 와 비교할 값을 고름
//   도구 이벤트: tool_name, SessionStart: source, PreCompact: trigger, Notification: notification_type
export function resolveMatcherValue(input: Record<string, unknown>): string | undefined {
  for (const key of ['tool_name', 'source', 'trigger', 'notification_type']) {
    const value = input[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

// 이벤트 중 stdout 일반 글자를 모델에게 넘기는 것
const PLAIN_STDOUT_AS_CONTEXT = new Set(['UserPromptSubmit', 'SessionStart'])

// 훅 한 개의 종료 코드와 출력을 읽음 (Claude Code 훅 규칙)
//   종료 코드 2: 막음. 이유는 stderr
//   종료 코드 0: stdout 이 JSON 이면 그 안의 결정을 읽고, 아니면 일부 이벤트에서만 모델에게 넘김
//   그 밖의 코드: 막지 않는 오류라 무시
export function readHookOutcome(event: string, exitCode: number, stdout: string, stderr: string): HookOutcome {
  if (exitCode === 2) {
    const reason = stderr.trim() || 'Blocked by hook'
    return event === 'PreToolUse' ? { permission: { decision: 'deny', reason } } : { block: reason }
  }
  if (exitCode !== 0) return {}

  const text = stdout.trim()
  if (!text) return {}
  let json: Record<string, any> | undefined
  if (text.startsWith('{')) {
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
  }
  if (!json) return PLAIN_STDOUT_AS_CONTEXT.has(event) ? { additionalContext: text } : {}

  const outcome: HookOutcome = {}
  if (json.continue === false) {
    outcome.preventContinuation = true
    if (typeof json.stopReason === 'string') outcome.stopReason = json.stopReason
  }
  if (json.decision === 'block') outcome.block = typeof json.reason === 'string' ? json.reason : 'Blocked by hook'
  const specific = json.hookSpecificOutput ?? {}
  if (typeof specific.additionalContext === 'string') outcome.additionalContext = specific.additionalContext
  const decision = specific.permissionDecision ?? (json.decision === 'approve' ? 'allow' : undefined)
  if (decision === 'allow' || decision === 'deny' || decision === 'ask') {
    outcome.permission = { decision, reason: specific.permissionDecisionReason ?? json.reason }
  }
  if (specific.updatedInput && typeof specific.updatedInput === 'object') outcome.updatedInput = specific.updatedInput
  return outcome
}

// 이벤트마다 결과에 넣을 수 있는 칸이 다름. additionalContext 를 받는 이벤트
const EVENTS_WITH_CONTEXT = new Set([
  'UserPromptSubmit', 'UserPromptExpansion', 'SessionStart', 'Setup', 'PostModelSwitch', 'SubagentStart',
  'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Stop', 'SubagentStop',
])

// 여러 훅의 결과를 Claude Code 에 돌려줄 결과 하나로 합침
//   PreToolUse: deny > ask > allow 순으로 강한 쪽을 따름
//   그 밖: 막은 훅이 하나라도 있으면 막음, 모델에게 넘길 글은 모두 이어 붙임
export function mergeHookOutcomes(event: string, outcomes: HookOutcome[]): Record<string, unknown> {
  const contexts = outcomes.map(o => o.additionalContext).filter((c): c is string => !!c)

  if (event === 'PreToolUse') {
    const result: Record<string, unknown> = {}
    const pick = (d: 'deny' | 'ask' | 'allow') => outcomes.find(o => o.permission?.decision === d)?.permission
    const deny = pick('deny') ?? (outcomes.find(o => o.block) ? { decision: 'deny', reason: outcomes.find(o => o.block)!.block } : undefined)
    const ask = pick('ask')
    const allow = pick('allow')
    if (deny) result.deny = deny.reason ?? 'Blocked by hook'
    else if (ask) result.ask = ask.reason ?? 'A hook asked for confirmation'
    else if (allow) result.allow = true
    const updated = [...outcomes].reverse().find(o => o.updatedInput)?.updatedInput
    if (updated && !deny) result.updatedInput = updated
    if (contexts.length) result.additionalContext = contexts
    return result
  }

  const result: Record<string, unknown> = {}
  const blocked = outcomes.find(o => o.block)
  if (blocked) result.block = blocked.block
  const stopped = outcomes.find(o => o.preventContinuation)
  if (stopped) {
    result.preventContinuation = true
    if (stopped.stopReason) result.stopReason = stopped.stopReason
  }
  if (contexts.length && EVENTS_WITH_CONTEXT.has(event)) result.additionalContext = contexts
  return result
}
