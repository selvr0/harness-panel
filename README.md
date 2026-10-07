# Harness Panel

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-4c6ef5?style=for-the-badge" alt="English"></a>
  <a href="./README.ko.md"><img src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-8b949e?style=for-the-badge" alt="한국어"></a>
</p>

A side panel for [Claude Code](https://code.claude.com) that shows every skill, hook and plugin loaded in the current directory, and turns each one on or off with one click.

![Harness Panel docked beside the conversation](./docs/screenshot-panel.png)

## Contents

- [Why we built this](#why-we-built-this)
- [1. Install](#1-install)
- [2. After installing](#2-after-installing)
- [3. What you can do in the panel](#3-what-you-can-do-in-the-panel)
- [4. Turn the panel itself off or on](#4-turn-the-panel-itself-off-or-on)
- [5. How turning off works](#5-how-turning-off-works)
- [6. Platforms](#6-platforms)
- [Notes](#notes)

## Why we built this

Harnesses are used to keep Claude Code within a project's code structure: skills tell it how to work, and hooks enforce the rules. With recent models, however, we began to suspect that existing harnesses were lowering performance rather than improving it.

Harness Panel is a tool built to test that. It turns individual skills and hooks on or off, and lets you open, edit or delete their files from the same panel. It is intended for anyone who needs to verify whether their harnesses still help.

## 1. Install

Type this at the Claude Code prompt:

```
/plugin install harness-panel --marketplace selvr0/harness-panel
```

1. `Add marketplace?` appears. Press `y`.
2. Choose the scope. `user` (all your projects) is the usual choice.
3. `Installed harness-panel. Plugin is now active.` appears.

## 2. After installing

Open the panel once:

```
/harness
```

From the next session on, it opens by itself.

**To dock it on the right**, Claude Code needs its fullscreen layout. Without it, the panel shows above the prompt instead.

```
/tui fullscreen
```

**To see the panel in Korean**, open `/config`, find `harness-panel`, and set `language` to `ko`.

## 3. What you can do in the panel

![A row opened to show its location and actions](./docs/screenshot-actions.png)

| You want to | Do this |
|---|---|
| Turn one skill or hook off or on | Press its `[ ON ]` / `[ OFF ]` button |
| Turn a whole section off or on | Press the button next to the section title |
| Jump to a section | Press its number key at the top, or click the tab |
| See where a file is and when a hook runs | Click its name |
| Open the file in your editor | Click its name, then `[ Open ]` |
| Move a skill or hook to the Trash | Click its name, then `[ Move to Trash ]`, then `[ Move ]` |
| Bring it back | Open the `Trash` section at the bottom, then `[ Restore ]` |
| Close the panel | `[ Close ]` at the top right |
| Open it again | `/harness` |

Every change applies to **the current directory only**. Each directory keeps its own on/off state.

### Sections

| Section | What is in it |
|---|---|
| This directory | Skills and hooks in `.claude/` of the directory you opened Claude Code in |
| Global | Skills and hooks in `~/.claude/` |
| claude.ai | Skills turned on in your claude.ai account |
| One section per plugin | That plugin's skills and hooks. The button next to the title turns the whole plugin on or off |
| Built-in | Skills that ship with Claude Code |

Skills from a plugin, claude.ai and Claude Code itself can be turned off, but not moved to the Trash.

## 4. Turn the panel itself off or on

The panel is a plugin, so you turn it off and on from Claude Code's plugin menu.

| You want to | Type |
|---|---|
| Turn the panel off | `/plugin disable harness-panel@harness-panel` |
| Turn it back on | `/plugin enable harness-panel@harness-panel` |
| Remove it | `/plugin uninstall harness-panel@harness-panel` |

Or open `/plugin`, go to **Installed**, select `harness-panel` and press Space.

Run `/reload-plugins` afterwards, or start a new session.

**What happens to what you turned off when the panel is off:**

| What you turned off | While the panel is off |
|---|---|
| Your skills, built-in and claude.ai skills | Stay off. They are saved in `.claude/settings.local.json`, which Claude Code reads by itself |
| Whole plugins | Stay off, same file |
| Plugin skills, hooks | **Run again.** Only the panel blocks these. They go back to off when the panel is turned back on |

## 5. How turning off works

| What | Where it is saved | Takes effect |
|---|---|---|
| Your skills, built-in and claude.ai skills | `skillOverrides` in `.claude/settings.local.json`, the same place `/skills` writes | Right away |
| Plugin skills | The panel's own storage. The panel blocks calls to the skill | Right away |
| Hooks | The panel's own storage. While a hook is off, the panel runs the other hooks on that event itself | Right away |
| A whole plugin | `enabledPlugins` in `.claude/settings.local.json` | After `/reload-plugins` |

Hooks are turned off one at a time. When a hook on an event is off, the panel runs the remaining hooks on that event itself, the same way Claude Code would. Only `command` hooks are run this way; other hook types on that event are skipped while any hook there is off.

## 6. Platforms

| | macOS | Windows | Linux |
|---|---|---|---|
| Open in editor (tried in order) | VS Code → Cursor → Zed → Sublime Text → TextEdit | VS Code → Cursor → Notepad | VS Code → Cursor → Zed → Sublime Text → `xdg-open` |
| Move to Trash | Finder Trash | Recycle Bin | `gio trash` → `trash-put` → `~/.local/share/Trash` |

Windows and Linux are covered by tests but have not been tried on real machines yet. Reports are welcome.

## Notes

- Built on Claude Code mods (function hooks), which are in early access. A Claude Code update may break the panel until it is updated.
- Claude Code cannot yet turn off a single plugin skill through `skillOverrides`, so the panel blocks those itself.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

[MIT](./LICENSE)
