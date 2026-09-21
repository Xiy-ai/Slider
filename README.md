# Slider for Claude Code

Use Claude Code desktop to build, run, inspect and test Windows applications in a local Slider VM on your Mac.

This repository contains only the Claude plugin. It does not contain the Slider app, Windows, VM disks or user data.

## Requirements

- Apple silicon Mac running macOS 26 or newer.
- A compatible Slider app with private developer control enabled, running Windows 11 ARM64.
- Guest helper 0.6.6 and control schema 3 (updated by compatible Slider builds).
- Node.js 20 or newer, and a local Claude Code session on the same Mac.

Version 0.3.6 was verified with the Slider Debug build on 21 September 2026. Public app availability is separate; check your installed app's readiness before use. Cloud sessions cannot reach this local VM. Keep Slider visible: minimizing may pause Windows.

## Install

Add `Xiy-ai/Slider` in Claude Code's plugin marketplace manager, then install `slider-for-claude` from `xiy-slider`.

Equivalent Claude Code commands:

```text
/plugin marketplace add Xiy-ai/Slider
/plugin install slider-for-claude@xiy-slider
```

Start a fresh local Code conversation after installation or updates. Ask Claude to check `windows_status` and `windows_readiness` before work.

This is a Claude Code plugin, including Code sessions in Claude Desktop. It is not a Claude Chat desktop extension. Claude displays its standard local MCP server permission warning; approve only tools you intend to use.

## Shared files

Select the intended project folder in Slider. Ask Claude to check the selected Mac path and Windows UNC path. Commands launched with that shared project as `working_directory` refresh closed files before launch. After Mac edits, existing sessions must call `windows_shared_folder_refresh` before reopening the files.

Refresh is bounded to 4096 paths including Unicode variants, and 1 MiB of path text. Open files can block refresh. This is not continuous synchronization, an editor-buffer update or a snapshot; finish Mac edits and keep files stable during builds. Verified imports into a new local Windows workspace remain available for larger projects or tools requiring local disk semantics.

## Verification

The package exposes 50 tools. Claude desktop directly passed shared builds and exact Unicode file reads. Final 0.3.6 testing verified explicit refresh in a still-running session, file-specific busy errors, and recovery after the file closed. The matching Codex package also passed direct desktop refresh testing. These checks do not establish that every tool, filesystem sharing mode or application has been tested.

## Privacy and access

The plugin runs a local MCP process and communicates with Slider's private local bridge. Slider does not require a cloud compute service for VM execution. Claude itself has its own account/network requirements. Windows commands and shared-file mutations can change or delete data; only share intended folders and preserve normal Claude tool approvals. Never share credentials or VM disks as project inputs.

## Support

Contact contact@xiy.ai. Product: https://slider.xiy.ai

Licensed under Apache-2.0; see LICENSE.
