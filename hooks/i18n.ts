// 패널에 보이는 모든 글자. /config 의 harness-panel.language 로 고름 (en | ko)

export type Language = 'en' | 'ko'

export type Messages = {
  panelTitle: string
  close: string
  summary: (total: number, on: number) => string
  location: string
  runsAt: string
  open: string
  moveToTrash: string
  confirmTrash: string
  confirmMove: string
  cancel: string
  trash: string
  restore: string
  kind: { skill: string; hook: string }
  // 켜고 끄는 버튼. 세 글자로 맞춰서 버튼 폭이 흔들리지 않게 함
  switch: { on: string; off: string; mixed: string }
  groups: {
    proj: { tab: string; title: string; where: string }
    user: { tab: string; title: string; where: string }
    synced: { tab: string; title: string; where: string }
    builtin: { tab: string; title: string; where: string }
    pluginWhere: string
  }
  hookEvents: Record<string, string>
  hookBeforeTool: (tool: string) => string
  hookAfterTool: (tool: string) => string
  untrashable: { pluginHook: string; pluginSkill: string; synced: string; builtin: string }
  toast: {
    noFileToOpen: (label: string) => string
    openFailed: (reason: string) => string
    movedToTrash: (label: string) => string
    trashFailed: (reason: string) => string
    restored: (label: string) => string
    restoreFailed: (reason: string) => string
    pluginToggled: (title: string, isOn: boolean) => string
  }
  error: {
    alreadyExists: (path: string) => string
    notInTrash: string
    hookNotFound: string
    cannotTrash: string
    cannotOpen: (path: string) => string
    cannotMove: (path: string) => string
  }
  command: { description: string; opened: string }
  // 모델이 읽는 안내 (꺼 둔 스킬을 부를 때)
  model: { skillOff: (name: string) => string }
}

const en: Messages = {
  panelTitle: 'Harness Panel',
  close: 'Close',
  summary: (total, on) => `${on} of ${total} on`,
  location: 'Location',
  runsAt: 'Runs at',
  open: 'Open',
  moveToTrash: 'Move to Trash',
  confirmTrash: 'Move to Trash?',
  confirmMove: 'Move',
  cancel: 'Cancel',
  trash: 'Trash',
  restore: 'Restore',
  kind: { skill: 'skill', hook: 'hook' },
  switch: { on: ' ON', off: 'OFF', mixed: 'MIX' },
  groups: {
    proj: { tab: 'Here', title: 'This directory', where: '.claude' },
    user: { tab: 'Global', title: 'Global', where: '~/.claude' },
    synced: { tab: 'claude.ai', title: 'anthropic-skills', where: 'claude.ai account' },
    builtin: { tab: 'Built-in', title: 'Built-in skills', where: 'Claude Code' },
    pluginWhere: 'plugin',
  },
  hookEvents: {
    UserPromptSubmit: 'When a prompt is sent',
    PreToolUse: 'Before a tool runs',
    PostToolUse: 'After a tool runs',
    SessionStart: 'Session start',
    SessionEnd: 'Session end',
    Stop: 'When a reply ends',
    SubagentStop: 'When a subagent ends',
    Notification: 'Notification',
    PreCompact: 'Before compaction',
  },
  hookBeforeTool: tool => `Before ${tool} runs`,
  hookAfterTool: tool => `After ${tool} runs`,
  untrashable: {
    pluginHook: 'Managed by a plugin, cannot be moved',
    pluginSkill: 'Managed by a plugin, cannot be moved',
    synced: 'Synced from claude.ai, cannot be moved',
    builtin: 'Built into Claude Code, cannot be moved',
  },
  toast: {
    noFileToOpen: label => `${label}: no file to open`,
    openFailed: reason => `Could not open: ${reason}`,
    movedToTrash: label => `${label} → Trash`,
    trashFailed: reason => `Could not move to Trash: ${reason}`,
    restored: label => `${label} restored. Skills may reappear from the next session`,
    restoreFailed: reason => `Could not restore: ${reason}`,
    pluginToggled: (title, isOn) => `${title} ${isOn ? 'on' : 'off'}. Run /reload-plugins to apply`,
  },
  error: {
    alreadyExists: path => `${path} already exists`,
    notInTrash: 'Not found in Trash. It may have been emptied',
    hookNotFound: 'This hook was not found in settings',
    cannotTrash: 'Cannot be moved to Trash',
    cannotOpen: path => `Could not open ${path}`,
    cannotMove: path => `Could not move ${path}`,
  },
  command: { description: 'Open the harness panel (turn skills, hooks and plugins on or off)', opened: 'Opened the harness panel.' },
  model: { skillOff: name => `The "${name}" skill is turned off in the harness panel. Tell the user and continue without it.` },
}

const ko: Messages = {
  panelTitle: '하네스 패널',
  close: '닫기',
  summary: (total, on) => `전체 ${total}개 중 ${on}개 켜짐`,
  location: '위치',
  runsAt: '실행 시점',
  open: '열기',
  moveToTrash: '휴지통으로 이동',
  confirmTrash: '휴지통으로 옮김?',
  confirmMove: '옮기기',
  cancel: '취소',
  trash: '휴지통',
  restore: '되돌리기',
  kind: { skill: '스킬', hook: '훅' },
  switch: { on: ' ON', off: 'OFF', mixed: '일부' },
  groups: {
    proj: { tab: '현재', title: '현재 디렉토리', where: '.claude' },
    user: { tab: '전역', title: '내 전역', where: '~/.claude' },
    synced: { tab: 'claude.ai', title: 'anthropic-skills', where: 'claude.ai 계정' },
    builtin: { tab: '기본', title: '기본 스킬', where: 'Claude Code' },
    pluginWhere: '플러그인',
  },
  hookEvents: {
    UserPromptSubmit: '질문 보낼 때',
    PreToolUse: '도구 실행 전',
    PostToolUse: '도구 실행 후',
    SessionStart: '세션 시작',
    SessionEnd: '세션 끝',
    Stop: '응답 끝',
    SubagentStop: '하위 에이전트 끝',
    Notification: '알림',
    PreCompact: '압축 전',
  },
  hookBeforeTool: tool => `${tool} 실행 전`,
  hookAfterTool: tool => `${tool} 실행 후`,
  untrashable: {
    pluginHook: '플러그인이 관리하는 훅이라 옮길 수 없음',
    pluginSkill: '플러그인이 관리하는 스킬이라 옮길 수 없음',
    synced: 'claude.ai 계정에서 받은 스킬이라 옮길 수 없음',
    builtin: 'Claude Code 기본 스킬이라 옮길 수 없음',
  },
  toast: {
    noFileToOpen: label => `${label}: 열 수 있는 파일이 없음`,
    openFailed: reason => `열지 못함: ${reason}`,
    movedToTrash: label => `${label} → 휴지통`,
    trashFailed: reason => `휴지통으로 옮기지 못함: ${reason}`,
    restored: label => `${label} 되돌림. 스킬은 다음 세션부터 목록에 다시 보일 수 있음`,
    restoreFailed: reason => `되돌리지 못함: ${reason}`,
    pluginToggled: (title, isOn) => `${title} ${isOn ? '켜짐' : '꺼짐'}. /reload-plugins 하면 적용됨`,
  },
  error: {
    alreadyExists: path => `${path} 자리에 이미 파일이 있음`,
    notInTrash: '휴지통에서 찾을 수 없음. 이미 비웠을 수 있음',
    hookNotFound: 'settings 에서 이 훅을 찾지 못함',
    cannotTrash: '휴지통으로 옮길 수 없음',
    cannotOpen: path => `${path} 를 열지 못함`,
    cannotMove: path => `${path} 를 옮기지 못함`,
  },
  command: { description: '하네스 패널 열기 (스킬·훅·플러그인 켜고 끄기)', opened: '하네스 패널을 열었음.' },
  model: { skillOff: name => `"${name}" 스킬은 하네스 패널에서 꺼 둔 상태임. 사용자에게 알리고 스킬 없이 진행할 것.` },
}

export const MESSAGES: Record<Language, Messages> = { en, ko }

// /config 값이 없거나 모르는 값이면 영어
export function resolveMessages(language: unknown): Messages {
  return language === 'ko' ? ko : en
}
