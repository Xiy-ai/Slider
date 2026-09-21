---
name: windows-development
description: "Build, test, inspect, debug, or visually operate Windows software in Slider's local Windows 11 ARM64 environment. Use when the user asks Claude Code to work on Windows, run a Windows build or UI test, inspect Windows developer tools or screens, interact with a Windows app, or transfer focused project files to or from Slider."
---

# Windows development with Slider

Use Slider's local Windows tools. Do not create a remote control service, require a cloud account, or replace Slider's private guest connection.

## Workflow

Installed builds expose connection metadata through Slider's signed bundled
`sliderctl control-endpoint` helper. The plugin uses it automatically when direct
discovery is unavailable. Do not print or copy its authentication token into chat
or logs. An older installed app may need updating alongside the plugin; do not
request broad disk access or change app-group permissions to bypass discovery.

1. Call `windows_status` before any Windows operation, then `windows_readiness` before development. Plugin 0.3 requires control schema 3 and guest agent 0.6.6. An old schema or disconnected agent is not a ready desktop. Do not bypass a protected prompt.
2. If Windows is stopped or paused, call `windows_start` and wait until `windows_status` reports `running`.
3. Discover the required tool before building. Use `windows_exec` with an absolute executable path. Common shells are:
   - `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
   - `C:\Windows\System32\cmd.exe`
4. For shared builds, set working_directory to the selected shared project so Slider refreshes its cached files before launch. Check cache_policy.ready first. Use verified local imports for larger trees or local-filesystem requirements. Before transferring or building a Mac project, call `windows_shared_folder_status` and compare `mac_path` with the requested project. Follow the shared-folder preflight below; do not assume the selected folder contains the project or append the project name twice. Use `C:\SliderWorkspaces\<project>` when a project needs a local Windows filesystem.
5. Use `windows_file_write` and `windows_file_read` for focused files. Each call is bounded to 8 MiB; do not use them to stream a repository, installer, virtual disk, or operating-system image.
6. Build and test through `windows_exec`. Capture the exact command, exit code, and relevant output. Treat a nonzero exit code as a failed build or test until explained.
7. Return produced artifacts through a user-approved shared path or focused file read. Do not claim an artifact exists without checking it.

## Visual testing

1. Use `windows_screenshot` to inspect the current VM framebuffer. Its metadata reports the exact pixel dimensions.
2. Use screenshot pixel coordinates with `windows_click`, `windows_hover` and `windows_scroll`; coordinates start at the top-left corner.
   `windows_hover` moves without clicking and optionally waits `duration_ms` (0–2000, default 500). Capture a screenshot to verify a tooltip or hover effect; elapsed time alone does not prove the UI responded.
   Use `windows_drag` for continuous strokes, selections, or moving items inside Windows. Supply 2–256 `points` with integer `x`/`y` screenshot coordinates, optional `duration_ms` (100–10000; default 1000), and `button` (left/right/middle). All points must be inside the current display. Wait for completion before sending other input, then capture a screenshot. If the display changes, capture fresh coordinates before retrying. This does not transfer files across the Mac/Windows boundary.
3. Use `windows_key` for shortcuts and navigation keys. Use `windows_type` for printable Unicode text, including accents and emoji, in the focused control.
4. Capture another screenshot after each state-changing visual action. Do not assume a click or keystroke had the intended effect without visual confirmation.
5. Prefer semantic command and file tools for development work. Use visual tools for app interaction and end-to-end UI validation.

## Command execution

Prefer direct executables with argument arrays. Set `working_directory` explicitly
for project work; it must exist under `C:\SliderWorkspaces` or the shared root returned by `windows_shared_folder_status`. `windows_exec` accepts
UTF-8 `stdin` and sends EOF after it. Environment values are passed directly without
shell expansion. Use PowerShell with `-NoProfile` and `-NonInteractive` when shell
syntax is required. A shell's own argument semantics still apply.

Foreground output is bounded to 4 MiB per stream. Inspect `stdout_truncated`,
`stderr_truncated`, `output_incomplete`, `stdin_error`, `timed_out`, and `exit_code`.
An exited foreground command's remaining descendants are cleaned up; use a
background session for a persistent server. Mutations carry recoverable operation IDs; follow the recovery section below after a transport failure.

## Background process sessions

Use these tools when the connected Slider build provides them:

1. `windows_session_start`: absolute executable, argument array, environment and
   working directory. Save the returned `session_id`. Default deadline is one hour;
   set `timeout_seconds` explicitly for longer work (maximum 24 hours).
2. `windows_session_poll`: pass the last `stdout.cursor` and `stderr.cursor` to get
   incremental UTF-8 output. Re-reading a retained cursor is safe. `dropped` means
   older output fell out of the 1 Mi UTF-16-character buffer for that stream.
   Poll results include `log_path`, `log_error` and `log_truncated`. Disk logs retain up to 64 Mi UTF-16 characters per stream, independently of the ring buffer, under `%ProgramData%/Slider/SessionLogs/session_id`. They remain after release; check errors before calling a log complete.
3. `windows_session_write`: send up to 65536 UTF-16 characters; `close: true` sends
   EOF afterward. Wait for `stdin_pending: false` before another write and inspect
   `stdin_error`. Queued input is not proof the application consumed it.
4. `windows_session_cancel`: terminate only the session's owned process tree.
   Poll again for final exit state and remaining output.
5. `windows_session_release`: discard the session and kill any remaining owned
   descendants. Release completed work to free capacity (16 sessions maximum).

A parent can exit while descendants still run or output pipes remain open. Check
stream `closed` and cursor/end values before declaring all output collected.
Sessions are invalid after a guest-agent restart. Exited sessions expire after
15 minutes without polling. VM pause also pauses Windows work; do not minimize or
pause Slider during a build without first checking the configured behavior.

Do not interpolate untrusted paths into a PowerShell string. Quote user-provided paths as PowerShell literals or pass them as parameters.

Use `windows_ip_address` only when a Windows service genuinely needs a guest address. Normal builds and file operations use Slider's private local bridge and do not require network discovery.

## Safety

- Preserve the user's installed software and project data.
- Ask before deleting a project, uninstalling software, changing Windows security policy, or shutting Windows down.
- Prefer `windows_pause` when the user wants to stop active VM work temporarily; it preserves the fast-resume experience.
- Never write credentials, signing material, ISO images, virtual disks, or secrets into the repository.
- Do not use external visual computer control when Slider's framebuffer and input tools can perform the operation directly.
- Treat screenshots as potentially sensitive. Describe relevant UI state without reproducing unrelated personal information.

## Boundaries

The tools provide command, process, networking, file, framebuffer, mouse, and keyboard control inside the one Slider Windows environment. They do not make individual Windows windows appear as native macOS windows and cannot interact with Windows' protected secure desktop.

## Workspace file operations

File tools accept `C:\SliderWorkspaces` and the selected shared root `\\localhost@9843\DavWWWRoot`. The internal name `__slider_shared__` is reserved at the local workspace root. Use `windows_file_mkdir` to
create parents, `windows_file_stat` for existence and metadata, and
`windows_file_list` for pages of at most 500 entries. Pass `next_offset` into the
next call; null means complete. Ordering reflects the live filesystem, so restart
listing if the directory changes. Listings identify reparse points but tools do
not follow them. Junctions, symbolic links, alternate streams and reserved Windows
filenames are rejected.

`windows_file_move` never overwrites and requires an existing destination parent.
`windows_file_delete` requires `recursive: true` for nonempty directories; the
workspace root cannot be moved or deleted. Recursive deletion preflights at most
100000 entries, rejects links, and is not atomic. Obtain authorization for deleting
user projects; disposable test files created for the current task can be cleaned up.
File writes replace existing files through a flushed temporary file in the same
directory. Individual reads and writes remain limited to 8 MiB.

## Shared project folder and build consistency

### Cache refresh before builds (plugin 0.3.6 / guest 0.6.6)

Check `cache_policy.ready` in shared status. An integration upgrade configures the
Windows WebDAV metadata cache and may report `restart_required: true`. Save work
and obtain any required user authorization for a normal Windows restart; a plugin
reload or VM pause is insufficient. Do not restart WebClient or edit registry
settings yourself. Local Windows workspaces remain available meanwhile.

When `working_directory` is a shared project directory, `windows_exec`,
`windows_session_start`, and `windows_launch` refresh that directory's cached
files before launching. Set this directory explicitly: a command launched from
`C:\SliderWorkspaces` with a UNC path hidden in its arguments does not receive a
project refresh. Individual shared file tools invalidate their target before use.

After Mac edits, call `windows_shared_folder_refresh {path: <shared project UNC>}`
before an **existing** session, dev server or GUI app re-reads those sources. Close
its file handles first. A successful refresh is a boundary for closed files;
`immediate_cache_coherence` remains false. Already-loaded editor buffers, open
file handles, file watchers and concurrent Mac edits are not synchronized.
Finish edits before refreshing and keep sources stable during a build.

The barrier rejects open/busy files, changed source inventories, links, unsupported
names and case collisions. It is bounded to 4096 paths (including composed/decomposed Unicode variants) and 1 MiB of path text;
use a smaller project subdirectory or a verified import for larger trees. Never
ignore a failed refresh and launch the build anyway. A partial invalidation changes
only caches, not source files; resolve the cause before retrying.

For local-disk semantics or unsupported projects, import each authorized revision
into a new `C:\SliderWorkspaces` directory, wait for `completed` and `verified:true`,
and build there. This remains a verified copy, not automatic synchronization.

### Required preflight and path mapping

Call `windows_shared_folder_status` after starting Windows. Read `configured`,
`mac_path`, `path`, `online`, and `error` before deciding sharing is unavailable.

- Compare the requested Mac project with `mac_path`. An online share may point to
  an unrelated folder (for example screenshots rather than source code).
- If the selected folder IS the project, use the returned `path` directly. If the
  project is inside it, append only the relative components with Windows backslashes.
  Example: Mac share `/Users/example/Projects`, project `Projects/MyApp` maps to
  `\\localhost@9843\DavWWWRoot\MyApp`. Sharing `MyApp` itself maps to the UNC root.
  Never pass a `/Users/...` Mac path to a Windows file tool or executable.
- If the project is outside the selected folder, explain the exact mismatch.
  Ask the user to select the intended folder with Slider's shared-folder button,
  or use the authorized bounded import/export tools below for a separate copy.
  Do not silently replace the selection or broaden it to the whole home directory.
- If no folder is configured, explain how to select one. If offline, inspect
  readiness and the returned error. First connection may need a normal shutdown
  and start after saving work; do not restart a working VM without authorization.
- List the mapped Windows directory and read a known project file. `online: true`
  alone does not prove access. If a transfer problem is reported, use a unique
  disposable subfolder to verify Mac write → Windows read and Windows write →
  Mac read. Compare exact text or hashes and remove only your test files.
- Report the failing operation, mapped path and actual error. Distinguish an
  unrelated selection, missing file, Mac permission failure, offline connector,
  copy-tool size limit and a tool that requires a local Windows disk. Do not claim
  Slider cannot share files merely because one project path is unavailable.

Mac-side writes need the coding task's own filesystem permission; Windows sharing
permission does not grant the task unrestricted Mac access. Keep both boundaries.
Shared files are the same files: saving or deleting from Windows affects the Mac.
There is no upload/download step for an already shared file. For build tools that
require local disk semantics, import an authorized source into `C:\SliderWorkspaces`
and export artifacts into a new authorized Mac directory; do not claim automatic
synchronization between those separate copies.


Choose an authorized Mac project folder using Slider's shared-folder button. The
first selection needs a normal Windows shutdown/start if the VM was already
running. The selection persists through security-scoped access; only that selected
folder is shared. Replacing an existing share can update the live connection.

Call `windows_shared_folder_status` for `configured`, `mac_path`, `path`, and
`online`. `online` means the connector is listening, not that a filesystem request
has succeeded: verify with `windows_file_list`. Windows uses the returned UNC path
(e.g. `\\localhost@9843\DavWWWRoot`); Mac edits and Windows artifacts use the same
folder, without an import/export step. The connector is loopback-only inside the
VM and uses Slider's existing private sharing channel.

Set PowerShell's working directory to the project subfolder. For .NET filesystem
calls use `$PWD.ProviderPath`, because `$PWD.Path` can include a provider prefix on
UNC locations. Some tools, especially cmd.exe, cannot use UNC working directories.
A small C# compile/run and a 16 MiB file were tested. Large build trees, file watchers, locking and Windows WebClient size limits
are not guaranteed by the cache barrier. Use a local
Windows workspace for tools requiring local-disk semantics. Do not change Windows
security policy or transfer the entire repository just to work around an error.

## Optional project import and artifact export

Use these bounded copy tools only when a separate local Windows copy is needed.
Use `windows_project_import` with an approved absolute `mac_source` directory and
new `windows_destination` below `C:\SliderWorkspaces`. Import stages files under a
unique workspace directory, verifies contents, and moves to the requested name
only after success. Common generated folders and Git metadata are excluded:
`.git`, `node_modules`, `.venv`, `venv`, `bin`, `obj`, `.DS_Store`. Review these
exclusions before transferring projects that intentionally use those names.

Use `windows_project_export` with a Windows source directory and a new absolute
`mac_destination` whose parent exists. Export includes all files and verifies
written contents. It never merges into an existing directory. Both tools reject
links and support up to 2000 entries, 256 MiB total, and 8 MiB per file. They do not
preserve executable bits, timestamps, ACLs or hard-link relationships. Keep sources
unchanged until completion; these are verified copies, not consistent snapshots.
Failures identify the partial directory for inspection and explicit cleanup. Never
retry a failed transfer blindly. Prefer the shared folder for artifacts beyond the copy-tool limit; its Windows filesystem limits still apply.
Mac access occurs in the plugin process under its existing permissions, not in
the sandboxed Slider app or guest runtime. Only transfer user-authorized data;
exclude credentials and unrelated files before selecting the source directory.

## Visible applications and reliable input

Use `windows_launch` for a GUI executable that must appear on the console desktop.
It launches as the signed-in user and stays open; the returned PID is not a background
session ID. Use `windows_list` to find the app and `windows_window_action` to focus it.
Use `windows_exec` and session tools for builds and captured output.

`windows_type` sends printable Unicode, including accents and emoji. Supply the
focused `window_id` when available. Use `windows_key` for Enter, Tab and shortcuts.
A focus change or held modifier stops typing: inspect before retrying to avoid
duplicate text. It reports queued input, not proof the application accepted it.

Every coordinate action (`windows_hover`, `windows_click`, `windows_drag`,
`windows_scroll`) requires `frame_id` from `windows_screenshot`. Capture again on
`stale_frame`. This guards display geometry, not controls moving within the same
resolution. Screenshots and visual actions are serialized; screenshot capture
is not a guarantee that an application has finished its own animation.

After a plugin update, test in a new Claude Code task so it loads the new tool schemas.
If tools are missing, report the plugin startup status; a working bundled server
alone does not prove Claude Code registered the plugin for the current task.

## Recovery and readiness (plugin 0.3)

Mutating tools automatically accept an operation, poll its receipt and return
`_operation.operation_id`. On interruption, use `windows_operation_status` with
that ID, or `windows_operation_list` if the plugin restarted before showing it.
For immediate acceptance without waiting, use `windows_operation_start` with a
`host_generation:UUID` ID obtained from `windows_status` and poll afterward.
Reusing an ID with different arguments is rejected. Never invent a new ID to
repeat an action whose outcome is unknown.

Receipts distinguish accepted, running, completed, failed, never_started and
outcome_unknown. Completed means the tool finished; inspect the command exit code
or UI result separately. A received failure can leave partial changes; a lost transport reply
can leave an unknown outcome. Receipts are memory-only within the current Slider
process (65536 IDs / 64 MiB result storage; older result payloads may expire while receipts remain); a Slider restart invalidates that epoch.
Guest-agent response retries also reuse request IDs and retain duplicate-protection
tombstones when old response payloads expire. Neither mechanism promises recovery
of a process after Windows or its agent has restarted.

`windows_readiness` reports bridge compatibility, guest generation, command mode,
desktop availability and a read-only shared-directory probe. It does not prove
write permission or identify the intended project for you. Check the selected Mac
path. A locked/protected/unavailable desktop requires human assistance, not bypasses.

`windows_session_list` rediscovers owned sessions after plugin reconnects. Use
`active_processes` and `parent_exited` alongside output closure; parent exit alone
is not completion of all child work. Working directory identifies the workspace.
Pass `terminal: true` at session start only for tools needing console semantics:
ConPTY uses 120×30 cells, UTF-8 VT output and merged stderr. Send `\r` to submit a
terminal line. Ordinary builds should retain the default separate redirected pipes.

## UI verification and larger trees

Window IDs include the guest generation. Acquire new IDs after an agent restart.
Mutations also accept an optional `guest_generation` precondition. Coordinate input
still requires a fresh `frame_id`; optionally add `expected_window_id` to require
foreground focus before dispatch. This is a preflight check, not a lock against
subsequent user movement or application animation.

Use `capture_after: true` on input/UI actions for an action result and subsequent
screenshot. A separate `capture_error` does not mean the action failed; do not
repeat the action just because capture failed. Captures include UTC timestamps
and physical-pixel dimensions; `windows_list` reports each window's DPI.

Use `root_element_id` to inspect or wait within a selected control. For a large
child list, use `children_only: true`, `limit`, and returned `next_offset`; restart
pagination when the tree changes. Exact `name`, `automation_id` and `control_type`
selectors filter the selected scope. A truncated search never proves absence.
Inspection reports value/text availability, selection and focus where supported;
password values and text remain protected.

`windows_ui_wait` supports exists, absent, enabled, disabled, focused, value_equals
and value_not_equals. `windows_window_wait` waits for an exact visible window title
to appear/disappear. Use these conditions to verify application behavior rather
than treating input delivery or a screenshot as proof of success.

## Large project and artifact transfers

Use `windows_transfer_start` when bounded import/export is too small and a shared
folder is unsuitable. These transfers run in the plugin process, not the model's
text context. They support at most 64 GiB total and 100000 entries, with 1 MiB
chunks. They copy directories; they do not synchronize or merge existing trees.

- `direction: "import"`: `mac_path` is an authorized Mac source directory;
  `windows_path` is a NEW directory below `C:\SliderWorkspaces`.
- `direction: "export"`: `windows_path` is the Windows source directory;
  `mac_path` is a NEW authorized Mac destination directory.
- Optional `exclude` is a list of exact basename components. Defaults exclude
  `.git`, `node_modules`, `.venv`, `venv`, `bin`, `obj`, `.DS_Store`. Pass `[]` when
  exporting build artifacts that intentionally live in bin/obj. Review exclusions.
- Save `transfer_id`. Poll `windows_transfer_status` for progress and errors.
  Initial enumeration/hashing occurs before acceptance; allow time for big trees.
- After an interruption use `windows_transfer_resume` with the SAME ID. Journals
  survive plugin restarts in `~/Library/Application Support/Slider/Transfers`.
  The plugin verifies existing chunks and full SHA256 hashes; conflicts fail
  rather than overwriting changed data. Keep sources unchanged throughout.
- `windows_transfer_cancel` stops at a chunk boundary and retains partial data.
  It never deletes the source. Review `partial_path` before explicit cleanup.
- One plugin process owns a transfer at a time. A live owner prevents duplicate
  resume. A dead owner's lock is recovered. A new host/guest generation does not
  license blind action retries; transfer resumption separately verifies file state.
- The Mac destination is visible while an export is incomplete. Only
  `state: "completed"` / `verified: true` means it is ready to use.
- Filesystem metadata, links and security policies are not replicated. Two-way
  synchronization and concurrent editing/conflict merging remain unsupported.

## Performance diagnostics

`windows_performance` reports Windows architecture, logical processors, total and
available memory, guest execution time, host bridge round trip and plugin round
trip. These measurements are nested, not additive. Bridge time includes queueing,
execution, transport and polling. Guest queue time is explicitly unavailable;
never present subtraction as a measurement of pure transport latency. HVF identifies
CPU virtualization; it does not prove GPU acceleration for a speech/AI model.

## Offline development checkpoints

Save Windows work and obtain permission before shutdown or restore. Windows must
be fully **stopped**, not paused. Checkpoints require same-volume APFS cloning and
no attached external writable disks. QCOW backing chains are rejected.

- `windows_checkpoint_create {name}` clones the VM package Data directory,
  including disks, UEFI and TPM, and records a SHA256 manifest. Names are 1–64
  letters/digits/underscores/hyphens. Existing names are never overwritten.
- `windows_checkpoint_list` reports logical size and whether configuration matches.
  APFS clones share extents; logical bytes are not exclusive physical disk usage.
- `windows_checkpoint_restore {name}` verifies content and requires the same VM
  configuration. It atomically replaces Data and retains the previous Data as a
  `before-restore-...` checkpoint. Reboot and acquire fresh session/window references.
- **Shared Mac folders and other external files are not restored.** Back up those
  separately before an experiment that modifies them. Restoring Windows can make
  its project state disagree with externally shared files.
- `windows_checkpoint_delete {name}` permanently deletes only that checkpoint;
  obtain approval before removing recovery points.
- Checkpoints contain user data and credentials. Never add them to source control
  or upload them. They reside inside the existing `.slider/Checkpoints` package.
- Save/restore can take time for disk hashing. Use `windows_operation_start` to
  obtain a receipt immediately, then poll. Following an app crash, inspect the
  checkpoint list and disk state; do not blindly replay an unknown restore.


## Desktop release 0.3.6 completion and failure rules

Use these same tools in the Claude Code desktop app; a terminal interface is not required.
Use Slider with its developer integration enabled and keep the VM visible while
working because minimizing can pause Windows. Never imply all access is available:
check windows_readiness and shared-folder status for the current VM.

- An operation receipt of `failed` is an explicit failure, not a lost reply.
  Inspect its error; partial changes are possible. Correct the cause before retrying.
  `outcome_unknown` means completion could not be established; query the receipt
  and inspect state instead of replaying the action. An operation-ID conflict must
  not replace or replay the original operation.
- Foreground commands and background sessions both write bounded logs under
  `%ProgramData%/Slider/SessionLogs/session_id`, outside the source workspace.
  Use returned `log_path` and session output fields. Old `.slider-sessions` folders
  may remain from prior versions; do not delete user files automatically.
- Window actions report `completed` and `pending`. If pending, use window waits
  or list windows to verify the requested state before further input.
- Session cancel reports `cancel_pending`; poll until the parent has exited and
  `active_processes` is zero. Check output stream completion before claiming all
  output has arrived.
- Transfer cancel reports `cancel_pending`; poll transfer status if true. A
  completed, verified transfer stays completed when cancellation arrives late.
- `capture_after` makes a bounded attempt to observe repaint and settling, and
  returns `capture_sync`. It does not prove app-level completion. Use UI/window
  waits for the expected control/value, then a fresh screenshot. No visual change
  can be valid (for example, clicking an already selected control).


Fresh desktop tasks are required after a plugin update: an existing Claude Code
session can retain the old MCP process even after `/reload-plugins` and even when
Settings displays the new installed version. Verify the running plugin version,
not only the installed manifest, before reporting a release test.

`windows_scroll.delta` counts wheel steps (positive down, negative up), not pixels.
Windows and the target application determine how far each step scrolls. Prefer
small values and inspect the result. Commands/sessions run in the guest bridge's
service context; visible `windows_launch` runs as the signed-in console user.
Never infer identical permissions or user profile paths between the two.

Current Slider readiness triggers its supported local helper upgrade when needed;
no new VM is required. An unknown helper version stays blocked. A disconnected
helper needs time to connect; report persistent upgrade failures instead of
starting a build with an incompatible bridge.

## Claude Code Desktop

Use a local Code session on the Mac running Slider. Cloud/remote sessions cannot
reach this local VM. Tools are supplied by the slider-windows MCP server; do not
invoke the bundled server manually when tools are already available. Ask for
normal per-tool permissions; never disable Claude's permission checks.
Keep Slider visible while working: minimizing may pause Windows. Check status
again after a pause, restart, or connection failure. Do not change VM lifecycle,
restore checkpoints, or shut down a VM containing unsaved work without consent.
