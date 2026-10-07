// 휴지통으로 옮길 수 있는 하네스가 어디 있는지
//   skill: 스킬 폴더(.claude/skills/<이름>) 또는 명령 파일(.claude/commands/<이름>.md)
//   hook:  settings 파일 안의 훅 한 개 + 그 훅이 실행하는 스크립트 파일
export type TrashableSource =
  | { kind: 'skill'; path: string }
  | {
      kind: 'hook'
      // 훅이 적힌 settings 파일 경로
      settingsFile: string
      // settings 안의 위치. 예: event "PreToolUse", matcher "Bash", command "python3 \"$CLAUDE_PROJECT_DIR/...\""
      event: string
      matcher: string
      command: string
      // 스크립트 파일 경로. 다른 훅이 같은 파일을 쓰면 undefined (파일은 남겨 둠)
      scriptPath?: string
    }

// 패널 한 줄(하네스 하나)
export type HarnessItem = {
  // 고유 id. 스킬은 "skill:<이름>", 훅은 "hook:<출처>:<이벤트>|<matcher>:<command>"
  id: string
  // 패널에 보이는 이름
  label: string
  // 화면에는 언어팩의 kind.skill / kind.hook 으로 보임
  kind: 'skill' | 'hook'
  isOn: boolean
  // 끄고 켤 때 무엇을 바꾸는지:
  //   skillOverrides: .claude/settings.local.json 의 skillOverrides
  //   pluginSkill:    이 mod 가 Skill 호출을 막음 (플러그인 스킬은 skillOverrides 가 안 먹음)
  //   hook:           이 mod 가 그 이벤트의 settings 훅 실행을 건너뜀
  control: 'skillOverrides' | 'pluginSkill' | 'hook'
  // control 이 skillOverrides·pluginSkill 일 때 스킬 이름, hook 일 때 "이벤트|matcher"
  target: string
  // 이름을 눌러 펼쳤을 때 "실행 시점"으로 보여주는 값. 훅만 있음. 예: "질문 보낼 때"
  detail?: string
  // [ 열기 ] 로 에디터에서 여는 파일. 기본 스킬처럼 파일이 없으면 undefined
  filePath?: string
  // 패널에 보여줄 짧은 경로. 세션 루트 아래면 그 뒤만, 홈 아래면 "~/..."
  displayPath?: string
  // 휴지통으로 옮길 수 있으면 그 위치. 플러그인·기본·동기화 스킬은 undefined
  trashable?: TrashableSource
  // trashable 이 없을 때 그 이유. 예: "플러그인이 관리함"
  untrashableReason?: string
}

// 패널 섹션 하나
export type HarnessGroup = {
  id: string
  // 섹션 탭에 쓰는 짧은 이름
  tab: string
  title: string
  where: string
  // 플러그인 섹션이면 "vercel@claude-plugins-official" 같은 id. 섹션 스위치가 플러그인 자체를 켜고 끔
  pluginId?: string
  isPluginOn?: boolean
  items: HarnessItem[]
}

// 패널 휴지통 섹션의 한 줄. $.store 에 폴더별로 저장함
export type TrashedHarness = {
  id: string
  label: string
  kind: 'skill' | 'hook'
  // 원래 자리와 휴지통 안의 자리. 되돌리면 trashedPath → originalPath 로 옮김
  //   trashedPath 가 없으면(윈도우 휴지통, 리눅스 gio) 되돌릴 때 운영체제 휴지통에서 originalPath 로 찾음
  //   훅인데 스크립트를 남겨 뒀으면 둘 다 undefined
  originalPath?: string
  trashedPath?: string
  // 훅이면 settings 에서 뺀 항목. 되돌리면 같은 자리에 다시 넣음
  hook?: { settingsFile: string; event: string; matcher: string; entry: Record<string, unknown> }
}

declare module 'claude-code' {
  interface PluginState {
    'harness-panel': {
      groups: HarnessGroup[]
      // key: 섹션 id, value: 펼쳐져 있는지
      openGroups: Record<string, boolean>
      // 한 번 클릭해서 아래에 버튼이 펼쳐진 줄의 id
      selectedItem: string | null
      // [ 휴지통으로 ] 를 눌러 확인을 기다리는 줄의 id
      confirmingTrash: string | null
      trash: TrashedHarness[]
    }
  }
}
