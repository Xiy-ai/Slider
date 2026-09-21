import { transferTool } from "./resumable-transfer.mjs";
import { readBundledEndpoints } from "./release-discovery.mjs";
import { transferProject } from "./project-transfer.mjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const SUFFIX = "slide.xiy.ai.runtime.sessions";
const MAX_RESPONSE = 16 * 1024 * 1024;

const frame = {type:"string",description:"frame_id returned by a recent windows_screenshot. Required; capture again after resizing."};
const tools = [
  tool("windows_list", "List visible windows on the unlocked Windows console desktop. Returns window_id, process ID, title, state and bounds in desktop physical pixels."),
  tool("windows_window_action", "Focus, move, resize, maximize, minimize or restore a window from windows_list. Windows may refuse focus or adjust bounds; inspect the returned state. Async state changes may still be settling.", {
    window_id:{type:"string",maxLength:128}, operation:{type:"string",enum:["focus","move","resize","maximize","minimize","restore"]},
    x:{type:"integer",minimum:-32767,maximum:32767},y:{type:"integer",minimum:-32767,maximum:32767},width:{type:"integer",minimum:1,maximum:32767},height:{type:"integer",minimum:1,maximum:32767},
  },["window_id","operation"]),
  tool("windows_ui_inspect", "Inspect up to 256 controls and depth 8 within a window. Returns opaque element IDs, names, types, supported patterns and desktop-pixel bounds. A truncated tree is incomplete. Inspect again after UI changes.", {window_id:{type:"string",maxLength:128}},["window_id"]),
  tool("windows_ui_action", "Invoke a control, fill its text value (Unicode supported), or select an item using a fresh element_id. Requires the appropriate UI Automation pattern. Does not expose password fields or the secure desktop. On timeout inspect before retrying: the action may have happened.", {
    window_id:{type:"string",maxLength:128},element_id:{type:"string",maxLength:512},operation:{type:"string",enum:["invoke","fill","select"]},value:{type:"string",maxLength:4096},
  },["window_id","element_id","operation"]),
  tool("windows_ui_wait", "Wait up to 10 seconds for an exact control name and/or automation_id in a window's bounded control tree. Optional control_type uses names like ControlType.Button. found=false does not prove absence beyond the inspection limits.", {
    window_id:{type:"string",maxLength:128},name:{type:"string",maxLength:2048},automation_id:{type:"string",maxLength:2048},control_type:{type:"string",maxLength:2048},timeout_ms:{type:"integer",minimum:0,maximum:10000,default:5000},
  },["window_id"]),
  tool("windows_shared_folder_status", "Required before shared project work: compare mac_path with the intended project and inspect online, error and cache_policy. cache_policy.ready must be true; upgrades may require one normal Windows restart. Shared file tools invalidate their target. Commands refresh the shared tree only when working_directory is the shared project. Use windows_shared_folder_refresh before an existing session or GUI app re-reads Mac edits. Keep sources stable while building. Larger trees should use verified local imports."),
  tool("windows_shared_folder_refresh", "Refresh cached files in a selected shared project directory after Mac edits. Commands/session launches do this automatically for a shared working_directory. Required before an already-running session or app re-reads shared sources. Up to 4096 paths (including Unicode variants) / 1 MiB path text. Rejects links, case collisions, concurrent Mac edits and files held open in Windows. Refreshed closed files are not a snapshot or an always-coherent filesystem.", {path:{type:"string",description:"Windows UNC directory inside the selected shared folder."}}, ["path"]),
  tool("windows_hover", "Move the Windows pointer without clicking, then wait up to 2 seconds for hover effects. Uses current screenshot pixels; capture a screenshot afterward to verify the result.", {
    frame_id: frame,
    x: {type:"integer",minimum:0}, y: {type:"integer",minimum:0}, duration_ms: {type:"integer",minimum:0,maximum:2000,default:500},
  }, ["frame_id","x","y"]),
  tool("windows_project_import", "Import an approved Mac source directory into a NEW Windows workspace directory. Excludes .git, node_modules, .venv, venv, bin, obj and .DS_Store. Limits: 8 MiB per file, 256 MiB total, 2000 entries. Rejects links; verifies file contents. Keep source unchanged during transfer.", {
    mac_source: {type:"string"}, windows_destination: {type:"string"},
  }, ["mac_source", "windows_destination"]),
  tool("windows_project_export", "Export a Windows workspace directory to a NEW approved Mac directory. Never merges or overwrites. Limits: 8 MiB per file, 256 MiB total, 2000 entries. Rejects links. Failures report the partial destination; keep source unchanged during transfer.", {
    windows_source: {type:"string"}, mac_destination: {type:"string"},
  }, ["windows_source", "mac_destination"]),
  tool("windows_status", "Show whether Slider's Windows environment is stopped, running, paused, or changing state."),
  tool("windows_start", "Start Slider's Windows environment or resume it from pause."),
  tool("windows_pause", "Pause Windows without shutting it down so it can resume quickly."),
  tool("windows_shutdown", "Ask Windows to shut down cleanly. Unsaved Windows work may be lost.", {}, [], true),
  tool("windows_ip_address", "Return Windows' non-loopback IP addresses."),
  tool("windows_screenshot", "Capture Windows as PNG plus frame_id. Pass frame_id to coordinate tools; resize invalidates it."),
  tool("windows_click", "Click a point in the Windows framebuffer. Coordinates use screenshot pixels from the top-left corner.", {
    frame_id: frame,
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 },
    button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
    clicks: { type: "integer", minimum: 1, maximum: 3, default: 1 },
  }, ["frame_id","x", "y"]),
  tool("windows_drag", "Hold a mouse button while moving smoothly through screenshot-pixel points, then release. Use two points for a straight drag or more for drawing. Capture a screenshot afterward. This does not transfer files between Mac and Windows.", {
    frame_id: frame,
    points: { type: "array", minItems: 2, maxItems: 256, items: {
      type: "object", properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } },
      required: ["x", "y"], additionalProperties: false,
    } },
    duration_ms: { type: "integer", minimum: 100, maximum: 10000, default: 1000 },
    button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
  }, ["frame_id","points"]),
  tool("windows_scroll", "Scroll at a point in Windows. Positive delta scrolls down and negative delta scrolls up.", {
    frame_id: frame,
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 },
    delta: { type: "integer", minimum: -120, maximum: 120 },
  }, ["frame_id","x", "y", "delta"]),
  tool("windows_key", "Send a Windows key or chord such as [\"CTRL\",\"L\"] or [\"WIN\",\"R\"].", {
    keys: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
  }, ["keys"]),
  tool("windows_type", "Type printable Unicode (including accents and emoji) into the focused Windows control. Optional window_id guards focus. No control characters: use windows_key. Maximum 10 seconds of typing per call; split longer text. Inspect after errors before retrying.", {
    window_id: { type: "string", maxLength: 128 },
    text: { type: "string", maxLength: 4096 },
    interval_ms: { type: "integer", minimum: 0, maximum: 250, default: 5 },
  }, ["text"]),
  tool("windows_launch", "Launch an executable visibly as the Windows console user. Returns process_id; the app remains open independently of the tool. Use windows_list to find its window. Use windows_exec/session tools for captured build output instead.", { executable:{type:"string"}, arguments:{type:"array",items:{type:"string"}}, working_directory:{type:"string"} },["executable"]),
  tool("windows_exec", "Run an executable inside Windows and return its exit code, standard output, and standard error.", {
    executable: { type: "string", description: "Absolute Windows executable path, such as C:\\Windows\\System32\\cmd.exe." },
    arguments: { type: "array", items: { type: "string" } },
    environment: { type: "object", additionalProperties: { type: "string" } },
    stdin: { type: "string", maxLength: 8388608 },
    working_directory: { type: "string", description: "Working directory under C:\\SliderWorkspaces or the path returned by windows_shared_folder_status; defaults to the local root." },
    timeout_seconds: { type: "number", minimum: 1, maximum: 3600, default: 600 },
  }, ["executable"]),
  tool("windows_session_start", "Start a background Windows process in an owned process tree. Returns immediately with session_id. Poll for incremental output; write stdin explicitly. Sessions expire on guest restart. Output is UTF-8 and bounded to the latest 1 Mi characters per stream; dropped counts report lost output.", {
    executable: { type: "string", description: "Absolute Windows executable path." },
    arguments: { type: "array", items: { type: "string" } },
    environment: { type: "object", additionalProperties: { type: "string" } },
    working_directory: { type: "string", description: "Directory under C:\\SliderWorkspaces or the selected shared root; defaults to the local root." },
    timeout_seconds: { type: "integer", minimum: 1, maximum: 86400, default: 3600 },
  }, ["executable"]),
  tool("windows_session_poll", "Read background process state, exit code and output. Pass returned stdout.cursor and stderr.cursor on the next poll. Repeating a cursor safely re-reads retained output. Exited processes may still have descendants or output pending; release when finished.", {
    session_id: { type: "string" },
    stdout_cursor: { type: "integer", minimum: 0 },
    stderr_cursor: { type: "integer", minimum: 0 },
    max_chars: { type: "integer", minimum: 1, maximum: 65536, default: 65536 },
  }, ["session_id"]),
  tool("windows_session_write", "Queue UTF-8 stdin for a process. Poll stdin_pending before another write. close sends EOF after this write. Acceptance does not mean the application consumed the input; check stdin_error and output.", {
    session_id: { type: "string" }, text: { type: "string", maxLength: 65536 },
    close: { type: "boolean", default: false },
  }, ["session_id", "text"]),
  tool("windows_session_cancel", "Terminate this session's owned process tree. Does not target unrelated Windows processes. Poll for final output and exit status.", {
    session_id: { type: "string" },
  }, ["session_id"], true),
  tool("windows_session_release", "Discard a session and its output, terminating any remaining owned descendants. Release finished sessions to free the 16-session limit. Completed sessions otherwise expire after 15 minutes without access.", {
    session_id: { type: "string" },
  }, ["session_id"], true),
  tool("windows_file_list", "List a directory under C:\\SliderWorkspaces or the selected shared root. Pagination uses live filesystem order; restart enumeration if the directory changes.", {
    path: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
    offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
  }, ["path"]),
  tool("windows_file_stat", "Inspect workspace file or directory metadata. Missing paths return exists=false. Links are not followed.", {
    path: { type: "string" },
  }, ["path"]),
  tool("windows_file_mkdir", "Create a workspace directory and missing parents. Existing directories are accepted.", {
    path: { type: "string" },
  }, ["path"]),
  tool("windows_file_move", "Move a workspace file or directory. Destination must not exist and its parent must exist. Cannot move the workspace root.", {
    path: { type: "string" }, destination: { type: "string" },
  }, ["path", "destination"], true),
  tool("windows_file_delete", "Delete a workspace file or empty directory. Nonempty directories require recursive=true; links and the workspace root are rejected. Recursive deletion is limited to 100000 entries and is not atomic.", {
    path: { type: "string" }, recursive: { type: "boolean", default: false },
  }, ["path"], true),
  tool("windows_file_read", "Read a UTF-8 or binary file from Windows. Binary content is returned as base64.", {
    path: { type: "string", description: "Absolute Windows file path." },
    max_bytes: { type: "integer", minimum: 1, maximum: 8388608, default: 1048576 },
  }, ["path"]),
  tool("windows_file_write", "Write a UTF-8 or base64-encoded file inside Windows, up to 8 MiB.", {
    path: { type: "string", description: "Absolute Windows destination path." },
    content: { type: "string" },
    encoding: { type: "string", enum: ["utf-8", "base64"], default: "utf-8" },
  }, ["path", "content"]),
];

tools.push(tool("windows_transfer_start", "Start a resumable verified directory copy outside the conversation. Import: Mac source to NEW Windows destination. Export: Windows source to NEW Mac destination. No merge or two-way sync. Up to 64 GiB/100000 entries; progress is persisted locally. Read the skill first.", {direction:{type:"string",enum:["import","export"]},mac_path:{type:"string"},windows_path:{type:"string"},exclude:{type:"array",maxItems:100,items:{type:"string"},description:"Excluded basename components; defaults exclude .git and common generated folders. Use [] to include build artifacts."}},["direction","mac_path","windows_path"]));
for(const action of ["status","resume","cancel"]) tools.push(tool("windows_transfer_"+action,"Inspect, resume or cancel a transfer by ID. Cancellation retains partial files. Resume verifies chunks and rejects conflicts; never change a source during transfer.",{transfer_id:{type:"string"}},["transfer_id"]));
tools.push(tool("windows_performance","Measure bridge round trip and guest execution; queue time is explicitly unavailable. Report actual guest architecture, processors and memory. Does not establish GPU model acceleration."));
tools.push(tool("windows_checkpoint_list","List local offline checkpoints. Windows must be fully stopped. Sizes are logical bytes; APFS clones share storage."));
for(const action of ["create","restore"]) tools.push(tool("windows_checkpoint_"+action,action==="create"?"Create a named offline checkpoint of package disks, UEFI and TPM. Requires fully stopped Windows and APFS. External writable disks are rejected; shared Mac files excluded.":"Restore a verified offline checkpoint. Requires fully stopped Windows and unchanged VM configuration. Replaces Windows disk state and retains a before-restore checkpoint. Shared Mac files are NOT restored. Obtain user approval for rollback.",{name:{type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"}},["name"],action==="restore"));
tools.push(tool("windows_checkpoint_delete","Permanently delete one named offline checkpoint to reclaim storage. Requires fully stopped Windows. Does not delete the live VM. Obtain approval before deleting a recovery point.",{name:{type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"}},["name"],true));
const recordedTools = new Set(["windows_checkpoint_delete","windows_checkpoint_create","windows_checkpoint_restore","windows_exec","windows_session_start","windows_session_write","windows_session_cancel","windows_session_release","windows_file_write","windows_file_mkdir","windows_file_move","windows_file_delete","windows_launch","windows_window_action","windows_ui_action","windows_hover","windows_click","windows_drag","windows_scroll","windows_key","windows_type"]);
for (const definition of tools) {
  if(recordedTools.has(definition.name)) Object.assign(definition.inputSchema.properties, {
    operation_id:{type:"string",description:"Reuse this exact ID to retrieve a previously accepted action, never a new ID after uncertain delivery. Omit to generate an ID."},
    guest_generation:{type:"string",description:"Optional expected guest generation from readiness. Reject stale references after guest restart."},
  });
  if(["windows_hover","windows_click","windows_drag","windows_scroll","windows_key","windows_type","windows_ui_action","windows_window_action"].includes(definition.name)) Object.assign(definition.inputSchema.properties, {
    expected_window_id:{type:"string",description:"Require this window to be foreground immediately before dispatch. Not an atomic guarantee against subsequent UI movement."},
    capture_after:{type:"boolean",description:"Return a screenshot after the action finishes. Capturing does not prove the application handled the input."},
  });
}
const selectors={root_element_id:{type:"string",maxLength:4096},name:{type:"string",maxLength:2048},automation_id:{type:"string",maxLength:2048},control_type:{type:"string",maxLength:2048}};
Object.assign(tools.find(t=>t.name==="windows_session_start").inputSchema.properties,{terminal:{type:"boolean",description:"Use a real ConPTY console (120x30). stdout contains UTF-8 VT terminal output, stderr is merged. Send CR to submit lines. Defaults to redirected pipes."}});
Object.assign(tools.find(t=>t.name==="windows_ui_inspect").inputSchema.properties,selectors,{children_only:{type:"boolean"},offset:{type:"integer",minimum:0,maximum:100000},limit:{type:"integer",minimum:1,maximum:256}});
tools.find(t=>t.name==="windows_ui_inspect").description="Inspect a selected subtree (256 nodes/depth 8) or page direct children using children_only, offset and limit. Expand any returned root_element_id. Exact selectors filter this scope. Live pagination is not a stable snapshot; restart after UI changes. Returns text/value/selection/focus where exposed, explicit truncation, and protects passwords.";
Object.assign(tools.find(t=>t.name==="windows_ui_wait").inputSchema.properties,selectors,{condition:{type:"string",enum:["exists","absent","enabled","disabled","focused","value_equals","value_not_equals"]},value:{type:"string",maxLength:4096}});
tools.find(t=>t.name==="windows_ui_wait").description="Wait for a control condition within a selected subtree. Absence is never confirmed from a truncated tree. Result distinguishes truncation, unsupported value pattern and condition not met.";
tools.push(tool("windows_window_wait","Wait up to ten seconds for a visible window with an exact title to appear or disappear. Protected desktops require user assistance.",{title:{type:"string",maxLength:2048},timeout_ms:{type:"integer",minimum:0,maximum:10000},absent:{type:"boolean"}},["title"]));
tools.push(tool("windows_readiness","Probe VM, bridge version/generation, command mode, desktop accessibility and selected shared-folder connectivity. Protected/locked desktops require user assistance."));
tools.push(tool("windows_session_list","List owned process sessions, commands, working directories, parent exit and active process counts. Sessions survive plugin reconnects; guest restart ends owned jobs. Logs remain under %ProgramData%/Slider/SessionLogs/session_id; terminal mode is reported explicitly."));
tools.push(tool("windows_operation_start","Accept a tool operation and return its ID immediately. Use host_generation:UUID as operation_id; obtain host_generation from windows_status. Poll status after reconnect, never duplicate an unknown operation. Receipts are scoped to this Slider process.",{operation_id:{type:"string"},tool:{type:"string"},arguments:{type:"object"}},["operation_id","tool","arguments"]));
tools.push(tool("windows_operation_status","Retrieve accepted/running/completed/failed/outcome_unknown/never_started operation receipt. Old host-generation IDs never replay. A completed command can have a nonzero exit code.",{operation_id:{type:"string"}},["operation_id"]));
tools.push(tool("windows_operation_list","Page operation receipts without result payloads, to recover IDs after a plugin reconnect. Receipts reset on Slider restart. Pagination is a live view.",{offset:{type:"integer",minimum:0,maximum:65536},limit:{type:"integer",minimum:1,maximum:200}}));

function tool(name, description, properties = {}, required = [], destructive = false) {
  const definition = {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false, ...(required.length ? { required } : {}) },
  };
  if (destructive) definition.annotations = { destructiveHint: true, readOnlyHint: false };
  return definition;
}

function endpointCandidates() {
  const roots = [join(homedir(), "Library", "Group Containers")];
  const candidates = ["/private/tmp/slide.xiy.ai/DeveloperControl/endpoint.json"];
  for (const root of roots) {
    let entries = [];
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith(SUFFIX)) {
        candidates.push(join(root, entry.name, "DeveloperControl", "endpoint.json"));
      }
    }
  }
  // Keep an already running development VM reachable during the identity
  // transition, without embedding a developer's personal bundle identifier.
  // The current product endpoint always takes precedence. Ambiguous legacy
  // installations require the user to open the current Slider build instead.
  try {
    const legacy = readdirSync("/private/tmp", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".slider"))
      .map((entry) => join("/private/tmp", entry.name, "DeveloperControl", "endpoint.json"))
      .filter((path) => existsSync(path));
    if (legacy.length === 1) candidates.push(legacy[0]);
  } catch {}
  return candidates;
}

function readEndpoints() {
  const endpoints = [];
  for (const path of endpointCandidates()) {
    try {
      const endpoint = JSON.parse(readFileSync(path, "utf8"));
      if (endpoint.host === "127.0.0.1" && Number.isInteger(endpoint.port) &&
          endpoint.port > 0 && endpoint.port <= 65535 && typeof endpoint.token === "string" && endpoint.token.length > 0) {
        if (!endpoints.some((value) => value.port === endpoint.port && value.token === endpoint.token)) endpoints.push(endpoint);
      }
    } catch {}
  }
  return endpoints;
}

async function launchSlider() {
  const explicit = process.env.SLIDER_APP_PATH;
  if (explicit && !existsSync(explicit)) throw new Error("SLIDER_APP_PATH does not exist.");
  const app = explicit || ["/Applications/Slider.app", join(homedir(), "Applications/Slider.app")].find(existsSync);
  const args = app ? [app] : ["-b", "slide.xiy.ai"];
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/open", args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Open Slider once, or set SLIDER_APP_PATH to its app bundle.")));
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function discoverEndpoint() {
  const probe = async () => {
    for (const endpoint of readEndpoints()) {
      try { await send(endpoint, "windows_status", {}, 1500); return endpoint; } catch {}
    }
    const apps = process.env.SLIDER_APP_PATH ? [process.env.SLIDER_APP_PATH] :
      ["/Applications/Slider.app", join(homedir(), "Applications/Slider.app")];
    for (const endpoint of await readBundledEndpoints(apps.filter(existsSync))) {
      try { await send(endpoint, "windows_status", {}, 1500); return endpoint; } catch {}
    }
    return null;
  };
  const existing = await probe();
  if (existing) return existing;
  await launchSlider();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const endpoint = await probe();
    if (endpoint) return endpoint;
    await delay(200);
  }
  throw new Error("Slider's private developer control is unavailable. Open Slider and try again.");
}

function send(endpoint, operation, args, timeoutMS) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: endpoint.host, port: endpoint.port });
    let response = Buffer.alloc(0);
    let dispatched = false;
    const timeoutSeconds = operation === "windows_exec" ? Number(args.timeout_seconds ?? 600) + 150
      : operation === "windows_shared_folder_refresh" ? 180 : 60;
    socket.setTimeout(timeoutMS ?? timeoutSeconds * 1000, () => socket.destroy(new Error("Slider developer request timed out.")));
    socket.on("connect", () => {
      dispatched = true;
      socket.write(`${JSON.stringify({ token: endpoint.token, operation, arguments: args })}\n`);
    });
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > MAX_RESPONSE) socket.destroy(new Error("Slider developer response is too large."));
      const newline = response.indexOf(0x0a);
      if (newline !== -1) {
        socket.end();
        try {
          const object = JSON.parse(response.subarray(0, newline).toString("utf8"));
          if (object.ok) resolve(object.result ?? {});
          else {
            const error = new Error(object.error || "Slider rejected the developer request.");
            error.code = object.error_code;
            error.source = object.source;
            error.detail = object.detail;
            error.responseReceived = true;
            reject(error);
          }
        } catch (error) { reject(error); }
      }
    });
    socket.on("error", (error) => { error.dispatched = dispatched; reject(error); });
    socket.on("end", () => {
      if (!response.includes(0x0a)) {
        const error = new Error("Slider closed the developer connection without a response.");
        error.dispatched = dispatched;
        reject(error);
      }
    });
  });
}

async function rawCall(operation,args) {
  const endpoint=await discoverEndpoint();
  try{return await send(endpoint,operation,args);}
  catch(error){if(error.dispatched||error.code!=="ECONNREFUSED")throw error;return await send(await discoverEndpoint(),operation,args);}
}

// Separate dependency injection makes reconnect/retry behavior testable without a VM.
async function recordedCall(operation,args,transport=rawCall,sleep=delay) {
  const status=await transport("windows_status",{});
  if(status.control_schema!==3)throw new Error("incompatible_control_schema: update Slider and its plugin together before running this action.");
  const id=args.operation_id ?? `${status.host_generation}:${randomUUID()}`;
  const {operation_id:ignored,...payload}=args;
  let receipt;
  try {
    try {receipt=await transport("windows_operation_start",{operation_id:id,tool:operation,arguments:payload});}
    catch(error) {
      if(!error.dispatched)throw error;
      receipt=await transport("windows_operation_status",{operation_id:id});
      // Only a receipt proves acceptance. Never blindly resubmit a mutation.
      if(receipt.state==="never_started")throw new Error("Acceptance was not confirmed. Query the operation again before retrying this same ID.");
    }
    const sharedLaunch = ["windows_exec", "windows_session_start", "windows_launch"].includes(operation)
      && /^\\\\localhost@9843\\DavWWWRoot(?:\\|$)/i.test(args.working_directory ?? "");
    const deadline=Date.now()+(Number(args.timeout_seconds??600)+(sharedLaunch?180:60))*1000;
    while(receipt.state==="accepted"||receipt.state==="running") {
      if(Date.now()>deadline)throw new Error("Operation is still pending; query its receipt instead of starting another action.");
      await sleep(250);
      try{receipt=await transport("windows_operation_status",{operation_id:id});}
      catch(error){if(!error.dispatched&&error.code!=="ECONNREFUSED")throw error;await sleep(250);receipt=await transport("windows_operation_status",{operation_id:id});}
    }
    if(receipt.state!=="completed")throw Object.assign(new Error(receipt.error??`Operation state: ${receipt.state}. Inspect before retrying.`),{code:receipt.error_code,source:receipt.source});
    if(receipt.result_unavailable)throw new Error(receipt.result_unavailable);
    return {...receipt.result,_operation:{operation_id:id,state:receipt.state,host_generation:receipt.host_generation}};
  }catch(error){error.operation_id=id;error.operation_state=receipt?.state??(error.responseReceived?"failed":"outcome_unknown");throw error;}
}
async function callSlider(operation,args) {
  if(recordedTools.has(operation))return recordedCall(operation,args);
  if(!["windows_status","windows_start","windows_pause","windows_shutdown"].includes(operation)) {
    const status=await rawCall("windows_status",{});
    if(status.control_schema!==3)throw new Error("incompatible_control_schema: update Slider and its plugin together.");
  }
  return rawCall(operation,args);
}

function write(object) { process.stdout.write(`${JSON.stringify(object)}\n`); }
function toolResult(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

function screenshotToolResult(value) {
  const { content_base64, mime_type, ...metadata } = value || {};
  if (typeof content_base64 !== "string" || mime_type !== "image/png") {
    throw new Error("Slider returned an invalid Windows screenshot.");
  }
  return {
    content: [
      { type: "image", data: content_base64, mimeType: mime_type },
      { type: "text", text: JSON.stringify(metadata) },
    ],
    isError: false,
  };
}

async function handle(request) {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") throw new Error("Invalid MCP request.");
  if (request.method.startsWith("notifications/")) return null;
  const id = request.id;
  switch (request.method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: {
        protocolVersion: request.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "slider-for-claude", version: "0.3.6" },
        instructions: "Plugin 0.3 requires control schema 3. Check windows_readiness before work. After an interrupted mutation query windows_operation_status with the returned operation_id; never blindly repeat unknown work. Expand/paginate truncated UI trees. Use windows_session_list to reconnect to surviving jobs. Use Slider's local Windows 11 ARM64 environment for Windows development and visual testing. Start or resume Windows before using guest tools. Before Mac/Windows file work, call windows_shared_folder_status, compare mac_path with the intended project, map its relative path onto the returned UNC path, and verify access. An online share may point at an unrelated folder; do not conclude file sharing is unsupported. Shared builds require cache_policy.ready and a shared project working_directory so Slider refreshes cached files before launch. Call windows_shared_folder_refresh before an existing session or app re-reads Mac edits. Keep sources stable during builds. For large trees or local-disk semantics, use verified imports into new Windows destinations. Use bounded windows_project_import/export for authorized separate local copies.",
      }};
    case "ping": return { jsonrpc: "2.0", id, result: {} };
    case "tools/list": return { jsonrpc: "2.0", id, result: { tools } };
    case "tools/call": {
      const name = request.params?.name;
      if (!tools.some((candidate) => candidate.name === name)) throw new Error(`Slider does not provide a tool named '${name}'.`);
      const args = request.params?.arguments || {};
      try {
        const started = performance.now();
        const result = name.startsWith("windows_transfer_") ? await transferTool(name, args, callSlider) : name.startsWith("windows_project_") ? await transferProject(name, args, callSlider) : await callSlider(name, args);
        if(name === "windows_performance") result.plugin_round_trip_ms = performance.now() - started;
        const failed = name === "windows_exec" && Number(result.exit_code) !== 0;
        const response = name === "windows_screenshot" ? screenshotToolResult(result) : result.screenshot ? {
          content: [...screenshotToolResult(result.screenshot).content, ...toolResult({...result,screenshot:undefined},failed).content],isError:failed
        } : toolResult(result, failed);
        return { jsonrpc: "2.0", id, result: response };
      } catch (error) {
        return { jsonrpc: "2.0", id, result: toolResult({ error: error.message, operation_id:error.operation_id, operation_state:error.operation_state, code: error.code, source: error.source, detail: error.detail }, true) };
      }
    }
    default: throw new Error(`Slider does not implement MCP method '${request.method}'.`);
  }
}

export { recordedCall, send, callSlider, readEndpoints, tools };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let visualChain = Promise.resolve();
let pending = 0;
const visualTools = new Set(["windows_launch", "windows_window_wait", "windows_list", "windows_window_action", "windows_ui_inspect", "windows_ui_action", "windows_ui_wait", "windows_hover", "windows_click", "windows_drag", "windows_scroll", "windows_key", "windows_type", "windows_screenshot"]);
lines.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } });
    return;
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } });
    return;
  }
  if (pending >= 32) {
    if (request.id !== undefined) write({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Too many pending Slider requests. Wait for a response before retrying." } });
    return;
  }
  pending++;
  const run = async () => {
    try {
      const response = await handle(request);
      if (response) write(response);
    } catch (error) {
      if (request?.id !== undefined) write({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error.message } });
    } finally { pending--; }
  };
  if (request.method === "tools/call" && visualTools.has(request.params?.name)) visualChain = visualChain.then(run);
  else void run();
});

}
