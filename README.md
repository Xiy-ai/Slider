# Slider for Claude Code

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/slider-icon-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/slider-icon.png">
  <img src="assets/slider-icon.png" alt="Slider" width="192" height="192">
</picture>

Use Claude Code desktop to build, run, inspect and test Windows applications in a local Slider VM on your Mac.

This repository contains only the Claude plugin. It does not contain the Slider app, Windows, VM disks or user data.

## Requirements

- Apple silicon Mac running macOS 26 or newer.
- A compatible Slider app with private developer control enabled, running Windows 11 ARM64.
- Guest helper 0.6.9 and control schema 3 (updated by compatible Slider builds).
- Node.js 20 or newer, and a local Claude Code session on the same Mac.

Version 0.3.9 matches the current Codex plugin release. On 3 October 2026, isolated package checks passed initialization and exact parity for all 50 tool schemas and capabilities. This does not establish a fresh Claude Desktop end-to-end test. Public app availability is separate; check your installed app's readiness before use. Cloud sessions cannot reach this local VM. Keep Slider visible: minimizing may pause Windows.

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

## Version 0.3.10

Directory artwork update: uses the original white Slider logo with reduced padding for better visibility. Tool behavior is unchanged from 0.3.9.

## Version 0.3.9

Includes export-resume integrity checks introduced in 0.3.7 and compatibility with guest helper 0.6.9. Update Slider and the plugin together. After updating, start a fresh local Claude Code session and check `windows_status` and `windows_readiness`.
