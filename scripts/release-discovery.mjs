import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execute = promisify(execFile);

// Only execute helpers inside the selected/installed Slider app bundles.
// Credentials stay in memory and never enter command arguments or log output.
export async function readBundledEndpoints(appPaths, run = execute) {
  const endpoints = [];
  for (const app of [...new Set(appPaths.filter(Boolean))]) {
    try {
      const { stdout } = await run(join(app, "Contents/MacOS/sliderctl"), ["control-endpoint"],
        { timeout: 4000, maxBuffer: 8192, encoding: "utf8" });
      const endpoint = JSON.parse(stdout);
      if (endpoint.host === "127.0.0.1" && Number.isInteger(endpoint.port) &&
          endpoint.port > 0 && endpoint.port <= 65535 &&
          typeof endpoint.token === "string" && endpoint.token.length > 0) endpoints.push(endpoint);
    } catch { /* Older apps lack this command; direct discovery may still work. */ }
  }
  return endpoints;
}
