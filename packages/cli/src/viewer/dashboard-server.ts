/**
 * Dashboard server: UI to view scan results, functions, actions and run CLI commands via buttons.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as http from "http";
import open from "open";
import * as path from "path";
import * as url from "url";

const DEFAULT_PORT = 3000;

/** Resolve path relative to cwd (server working directory). */
function resolvePath(cwd: string, p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(cwd, p);
}

const EXIT_PREFIX = "\n__EXIT__:";

/**
 * Run CLI command and stream stdout/stderr to the response. Writes __EXIT__:code at the end.
 * Response is text/plain; client should parse the final line for exit code.
 */
function runCliStream(
  cwd: string,
  cliPath: string,
  args: string[],
  res: http.ServerResponse,
  onProc: (proc: ChildProcess | null) => void
): void {
  const proc = spawn("node", [cliPath, ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  onProc(proc);

  const write = (chunk: string | Buffer) => {
    if (res.writableEnded) return;
    try {
      res.write(chunk);
    } catch {
      proc.kill("SIGTERM");
    }
  };

  proc.stdout?.on("data", (chunk: Buffer) => write(chunk));
  proc.stderr?.on("data", (chunk: Buffer) => write(chunk));

  proc.on("close", (code, signal) => {
    if (signal) {
      write(`\n[Process ${signal}]\n`);
    }
    if (!res.writableEnded) {
      res.write(EXIT_PREFIX + (code ?? "null") + "\n");
      res.end();
    }
    onProc(null);
  });

  proc.on("error", (err) => {
    write((err.message || String(err)) + "\n");
    if (!res.writableEnded) {
      res.write(EXIT_PREFIX + "1\n");
      res.end();
    }
    onProc(null);
  });
}

export interface DashboardServerOptions {
  port?: number;
  cwd?: string;
  openBrowser?: boolean;
}

export async function startDashboardServer(
  options: DashboardServerOptions = {}
): Promise<void> {
  const port = options.port ?? DEFAULT_PORT;
  const cwd = options.cwd ?? process.cwd();
  const cliPath = path.join(__dirname, "..", "cli.js");
  let currentProc: ChildProcess | null = null;

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || "/", true);
    const pathname = parsedUrl.pathname || "/";
    const query = parsedUrl.query as Record<string, string>;

    const setCors = () => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
    };

    try {
      if (pathname === "/" || pathname === "/index.html") {
        const html = await getDashboardHTML();
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      if (pathname === "/api/scan-result") {
        const filePath = resolvePath(
          cwd,
          query.path || "results/restoinspect.json"
        );
        try {
          const content = await fs.readFile(filePath, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(content);
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "File not found",
              path: filePath,
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/functions/list") {
        const dir = resolvePath(cwd, query.dir || "functions/resto-inspect");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name)
            .sort();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ dir, files }));
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Directory not found",
              path: dir,
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/functions/file" && req.method !== "DELETE") {
        const dir = resolvePath(cwd, query.dir || "functions/resto-inspect");
        const file = query.file;
        if (!file || file.includes("..")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file" }));
          return;
        }
        const filePath = path.join(dir, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(content);
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "File not found",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/actions/list") {
        const dir = resolvePath(cwd, query.dir || "actions/resto-inspect");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name)
            .sort();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ dir, files }));
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Directory not found",
              path: dir,
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/actions/file" && req.method !== "DELETE") {
        const dir = resolvePath(cwd, query.dir || "actions/resto-inspect");
        const file = query.file;
        if (!file || file.includes("..")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file" }));
          return;
        }
        const filePath = path.join(dir, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(content);
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "File not found",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/functions/file" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "functions/resto-inspect");
        const file = query.file;
        if (!file || file.includes("..") || !file.endsWith(".json")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file" }));
          return;
        }
        const filePath = path.join(dir, file);
        try {
          await fs.unlink(filePath);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: file }));
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete failed",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/functions/all" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "functions/resto-inspect");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name);
          for (const file of files) {
            await fs.unlink(path.join(dir, file));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: files.length, files }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete all failed",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/actions/file" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "actions/resto-inspect");
        const file = query.file;
        if (!file || file.includes("..") || !file.endsWith(".json")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file" }));
          return;
        }
        const filePath = path.join(dir, file);
        try {
          await fs.unlink(filePath);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: file }));
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete failed",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/actions/all" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "actions/resto-inspect");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name);
          for (const file of files) {
            await fs.unlink(path.join(dir, file));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: files.length, files }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete all failed",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/results/list") {
        const dir = resolvePath(cwd, query.dir || "results");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name)
            .sort();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ dir, files }));
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Directory not found",
              path: dir,
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/results/file" && req.method !== "DELETE") {
        const dir = resolvePath(cwd, query.dir || "results");
        const file = query.file;
        if (!file || file.includes("..")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file" }));
          return;
        }
        const filePath = path.join(dir, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(content);
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "File not found",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/results/file" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "results");
        const file = query.file;
        if (!file || file.includes("..") || !file.endsWith(".json")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file" }));
          return;
        }
        const filePath = path.join(dir, file);
        try {
          await fs.unlink(filePath);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: file }));
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete failed",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/results/all" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "results");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name);
          for (const file of files) {
            await fs.unlink(path.join(dir, file));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: files.length, files }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete all failed",
              message: e instanceof Error ? e.message : String(e),
            })
          );
        }
        return;
      }

      if (pathname === "/api/run" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const params = JSON.parse(body || "{}") as {
          command: string;
          scanDir?: string;
          outputPath?: string;
          functionCodeDir?: string;
          functionsDir?: string;
          actionsInputDir?: string;
          actionsOutputDir?: string;
          appName?: string;
          serviceKey?: string;
          fix?: boolean;
          uploadUrl?: string;
        };
        const { command } = params;
        let args: string[] = [];
        if (command === "scan") {
          const scanDir = params.scanDir || ".";
          const outputPath = params.outputPath || "results/restoinspect.json";
          const functionCodeDir =
            params.functionCodeDir || "functions/resto-inspect";
          args = [
            "scan",
            scanDir,
            "-o",
            outputPath,
            "--function-code-dir",
            functionCodeDir,
          ];
        } else if (command === "validate-functions") {
          const inputDir = params.functionsDir || "functions/resto-inspect";
          args = ["validate-functions", inputDir];
          if (params.fix) args.push("--fix");
        } else if (command === "actions") {
          const inputDir = params.actionsInputDir || "functions/resto-inspect";
          const outputDir = params.actionsOutputDir || "actions/resto-inspect";
          args = ["actions", inputDir, "-o", outputDir];
          if (params.serviceKey?.trim())
            args.push("--service-key", params.serviceKey.trim());
          if (params.appName) args.push("--name", params.appName);
        } else if (command === "upload-actions") {
          const inputDir = params.actionsOutputDir || "actions/resto-inspect";
          args = ["upload-actions", inputDir];
          if (params.uploadUrl) args.push("--url", params.uploadUrl);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unknown command", command }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        });
        runCliStream(cwd, cliPath, args, res, (proc) => {
          currentProc = proc;
        });
        return;
      }

      if (pathname === "/api/run/stop" && req.method === "POST") {
        if (currentProc) {
          currentProc.kill("SIGTERM");
          currentProc = null;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ stopped: true }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ stopped: false, message: "No process running" })
          );
        }
        return;
      }

      if (pathname === "/api/run/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ running: currentProc != null }));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, async () => {
      const dashboardUrl = `http://localhost:${port}`;
      console.log(`\n✓ Dashboard at ${dashboardUrl}`);
      console.log(`  CWD: ${cwd}`);
      if (options.openBrowser !== false) {
        try {
          await open(dashboardUrl);
        } catch {
          console.log("  (Could not open browser automatically)");
        }
      }
      console.log("\n  Press Ctrl+C to stop.\n");
      process.on("SIGINT", () => {
        server.close(() => process.exit(0));
      });
      resolve();
    });
    server.on("error", reject);
  });
}

function getDashboardHTML(): string {
  return DASHBOARD_HTML;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Surface Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --bg: #0f0f12; --surface: #18181b; --border: #27272a; --text: #e4e4e7; --text-muted: #a1a1aa; --hover: #27272a; --hover-strong: #3f3f46; --code-bg: #0f0f12; --stat-bg: #27272a; --arrow: #71717a; }
    [data-theme="light"] { --bg: #f4f4f5; --surface: #fff; --border: #e4e4e7; --text: #18181b; --text-muted: #71717a; --hover: #f4f4f5; --hover-strong: #e4e4e7; --code-bg: #fafafa; --stat-bg: #f4f4f5; --arrow: #71717a; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; min-height: 100vh; transition: background 0.2s, color 0.2s; margin: 0; }
    .app { max-width: 1400px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; }
    .panels-wrap { flex: 1; min-height: 0; overflow: auto; }
    .command-output { flex-shrink: 0; border-top: 1px solid var(--border); margin-top: 8px; padding: 12px 16px; background: var(--surface); border-radius: 8px; }
    .command-output-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .command-output-header h3 { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0; }
    .command-output .log-box { max-height: 180px; margin-top: 0; }
    header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    h1 { font-size: 1.5rem; font-weight: 600; }
    .theme-toggle { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); cursor: pointer; font-size: 13px; }
    .theme-toggle:hover { background: var(--hover-strong); color: var(--text); }
    .theme-toggle svg { width: 18px; height: 18px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 20px; }
    .tabs button { padding: 10px 18px; border: none; border-radius: 8px; background: var(--stat-bg); color: var(--text-muted); cursor: pointer; font-size: 14px; transition: background 0.2s, color 0.2s; }
    .tabs button:hover { background: var(--hover-strong); color: var(--text); }
    .tabs button.active { background: #3b82f6; color: #fff; }
    .panel { display: none; background: var(--surface); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; transition: background 0.2s, border-color 0.2s; }
    .panel.active { display: block; }
    .panel-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .panel-header h2 { font-size: 1rem; font-weight: 600; }
    .panel-body { padding: 20px; max-height: 60vh; overflow: auto; }
    .actions-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .btn { padding: 10px 18px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: var(--stat-bg); color: var(--text); }
    .btn-secondary:hover { background: var(--hover-strong); }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.hidden { display: none; }
    .log-box { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 280px; overflow: auto; margin-top: 16px; transition: background 0.2s, border-color 0.2s; }
    .log-box.success { border-color: #22c55e; }
    .log-box.error { border-color: #ef4444; }
    .file-list { list-style: none; }
    .file-list li { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
    .file-list li:hover { background: var(--hover); }
    .file-list li:last-child { border-bottom: none; }
    .accordion { list-style: none; }
    .accordion-item { border-bottom: 1px solid var(--border); }
    .accordion-item:last-child { border-bottom: none; }
    .accordion-head { padding: 12px 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; user-select: none; }
    .accordion-head:hover { background: var(--hover); }
    .accordion-head-inner { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
    .accordion-head-inner::before { content: '▶'; font-size: 10px; color: var(--arrow); transition: transform 0.2s; flex-shrink: 0; }
    .accordion-item.expanded .accordion-head-inner::before { transform: rotate(90deg); }
    .btn-icon { padding: 6px; border: none; border-radius: 6px; background: transparent; color: var(--arrow); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .btn-icon:hover { background: var(--hover-strong); color: #ef4444; }
    .btn-icon svg { width: 16px; height: 16px; }
    .panel-header .btn-icon { padding: 8px; }
    .panel-header .btn-icon svg { width: 18px; height: 18px; }
    .accordion-body { display: none; border-top: 1px solid var(--border); overflow: hidden; }
    .accordion-item.expanded .accordion-body { display: block; }
    .accordion-body .json-preview { margin: 0; border-radius: 0; border: none; max-height: 400px; }
    .endpoint { padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .endpoint:last-child { border-bottom: none; }
    .endpoint-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .method { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .method.get { background: #1e3a5f; color: #93c5fd; }
    .method.post { background: #14532d; color: #86efac; }
    .method.put { background: #78350f; color: #fcd34d; }
    .method.delete { background: #7f1d1d; color: #fca5a5; }
    .url { font-family: ui-monospace, monospace; font-size: 13px; color: var(--text-muted); }
    .detail { font-size: 12px; color: var(--text-muted); margin-top: 8px; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .stat { padding: 12px 16px; background: var(--stat-bg); border-radius: 8px; transition: background 0.2s; }
    .stat strong { display: block; font-size: 1.25rem; color: #3b82f6; }
    .json-preview { background: var(--code-bg); border-radius: 8px; padding: 16px; font-size: 12px; overflow: auto; max-height: 400px; white-space: pre-wrap; word-break: break-all; transition: background 0.2s; }
    .header-top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .panel-config { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; }
    .panel-config-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 10px; }
    .inputs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px 24px; }
    .input-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .input-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text); margin: 0; }
    .input-group input { padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--stat-bg); color: var(--text); width: 100%; font-size: 13px; transition: background 0.2s, border-color 0.2s, color 0.2s; box-sizing: border-box; }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="header-top">
        <h1>API Surface Dashboard</h1>
        <button type="button" class="theme-toggle" id="themeToggle" title="Switch theme" aria-label="Switch theme"><span id="themeIcon"></span><span id="themeLabel">Dark</span></button>
      </div>
    </header>

    <div class="tabs">
      <button type="button" class="active" data-tab="scan">Scan</button>
      <button type="button" data-tab="results">Results</button>
      <button type="button" data-tab="functions">Functions</button>
      <button type="button" data-tab="actions">Actions</button>
    </div>

    <div class="panels-wrap">
    <div id="panel-scan" class="panel active">
      <div class="panel-config">
        <div class="panel-config-title">Scan</div>
        <div class="inputs">
          <div class="input-group">
            <label for="scanDir">Repo to scan</label>
            <input type="text" id="scanDir" value="." placeholder="e.g. . or ./src" title="Directory to scan for API calls" />
          </div>
          <div class="input-group">
            <label for="scanOutputPath">Scan output file</label>
            <input type="text" id="scanOutputPath" value="results/restoinspect.json" title="Path to the scan result JSON file to display" />
          </div>
        </div>
      </div>
      <div class="panel-header"><h2>Scan</h2><div class="actions-bar"><button type="button" class="btn btn-primary" id="runScan">Scan</button><button type="button" class="btn btn-danger hidden" id="runStopScan">Stop</button><button type="button" class="btn btn-secondary" id="refreshScan">Refresh</button></div></div>
      <div class="panel-body" id="scanBody"><div class="log-box">Loading...</div></div>
    </div>

    <div id="panel-results" class="panel">
      <div class="panel-config">
        <div class="panel-config-title">Results directory</div>
        <div class="inputs">
          <div class="input-group">
            <label for="resultsDir">Results dir</label>
            <input type="text" id="resultsDir" value="results" placeholder="e.g. results" title="Directory containing scan result JSON files" />
          </div>
        </div>
      </div>
      <div class="panel-header"><h2>Result JSON files</h2><div style="display:flex;gap:8px;align-items:center;"><button type="button" class="btn btn-danger" id="deleteAllResults" title="Delete all JSON files in this directory"><span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete All</span></button><button type="button" class="btn btn-secondary" id="refreshResults">Refresh</button></div></div>
      <div class="panel-body"><ul class="accordion" id="resultsList"></ul></div>
    </div>

    <div id="panel-functions" class="panel">
      <div class="panel-config">
        <div class="panel-config-title">Functions directory</div>
        <div class="inputs">
          <div class="input-group">
            <label for="functionsDir">Functions dir</label>
            <input type="text" id="functionsDir" value="functions/resto-inspect" title="Directory containing function JSON files (input for validate & generate actions)" />
          </div>
        </div>
      </div>
      <div class="panel-header"><h2>Function JSON files</h2><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><div class="actions-bar"><button type="button" class="btn btn-primary" id="runValidate">Validate functions</button><label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);margin:0;"><input type="checkbox" id="validateFix" /> Validate with --fix</label><button type="button" class="btn btn-danger hidden" id="runStopValidate">Stop</button></div><button type="button" class="btn btn-danger" id="deleteAllFunctions" title="Delete all JSON files in this directory"><span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete All</span></button><button type="button" class="btn btn-secondary" id="refreshFunctions">Refresh</button></div></div>
      <div class="panel-body"><ul class="accordion" id="functionsList"></ul></div>
    </div>

    <div id="panel-actions" class="panel">
      <div class="panel-config">
        <div class="panel-config-title">Generate &amp; upload actions</div>
        <div class="inputs">
          <div class="input-group">
            <label for="actionsDir">Actions dir</label>
            <input type="text" id="actionsDir" value="actions/resto-inspect" title="Output directory for generated action JSON files" />
          </div>
          <div class="input-group">
            <label for="appName">App name</label>
            <input type="text" id="appName" value="resto-inspect" placeholder="e.g. resto-inspect" title="Used in generated action names" />
          </div>
          <div class="input-group">
            <label for="serviceKey">Service key</label>
            <input type="text" id="serviceKey" value="rm_playground_database" placeholder="e.g. rm_playground_database" title="serviceKey for generated actions" />
          </div>
        </div>
      </div>
      <div class="panel-header"><h2>Action JSON files</h2><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><div class="actions-bar"><button type="button" class="btn btn-primary" id="runActions">Generate actions</button><button type="button" class="btn btn-primary" id="runUpload">Upload actions</button><button type="button" class="btn btn-danger hidden" id="runStopActions">Stop</button></div><button type="button" class="btn btn-danger" id="deleteAllActions" title="Delete all JSON files in this directory"><span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete All</span></button><button type="button" class="btn btn-secondary" id="refreshActions">Refresh</button></div></div>
      <div class="panel-body"><ul class="accordion" id="actionsList"></ul></div>
    </div>

    </div>

    <div class="command-output">
      <div class="command-output-header">
        <h3>Command output</h3>
        <button type="button" class="btn btn-danger hidden" id="runStop">Stop</button>
      </div>
      <div class="log-box" id="runLog">Output will appear here after running a command.</div>
    </div>
  </div>

  <script>
    (function initTheme() {
      const stored = localStorage.getItem('dashboard-theme');
      const theme = stored === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      function renderThemeUI() {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        const icon = document.getElementById('themeIcon');
        const label = document.getElementById('themeLabel');
        if (icon) icon.innerHTML = isDark ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
        if (label) label.textContent = isDark ? 'Dark' : 'Light';
      }
      renderThemeUI();
      document.getElementById('themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('dashboard-theme', next);
        renderThemeUI();
      });
    })();

    const scanDir = () => document.getElementById('scanDir').value.trim() || '.';
    const scanOutputPath = () => document.getElementById('scanOutputPath').value;
    const resultsDir = () => document.getElementById('resultsDir').value.trim() || 'results';
    const functionsDir = () => document.getElementById('functionsDir').value;
    const actionsDir = () => document.getElementById('actionsDir').value;
    const appName = () => document.getElementById('appName').value;
    const serviceKey = () => document.getElementById('serviceKey').value.trim();

    document.querySelectorAll('.tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      });
    });

    async function api(path, opts) {
      const r = await fetch(path, opts);
      const text = await r.text();
      if (!r.ok) throw new Error(text || r.statusText);
      try { return JSON.parse(text); } catch { return text; }
    }

    async function loadScan() {
      const el = document.getElementById('scanBody');
      try {
        const data = await api('/api/scan-result?path=' + encodeURIComponent(scanOutputPath()));
        const summary = data.summary || {};
        const endpoints = data.endpoints || [];
        let html = '<div class="stats">';
        html += '<div class="stat"><strong>' + (summary.totalCalls || 0) + '</strong> Total calls</div>';
        html += '<div class="stat"><strong>' + (summary.uniqueEndpoints || 0) + '</strong> Unique endpoints</div>';
        html += '<div class="stat"><strong>' + (summary.filesScanned || 0) + '</strong> Files scanned</div></div>';
        html += '<div class="endpoints">';
        endpoints.slice(0, 100).forEach(ep => {
          html += '<div class="endpoint"><div class="endpoint-header"><span class="method ' + (ep.method || '').toLowerCase() + '">' + (ep.method || '') + '</span><span class="url">' + escapeHtml(ep.url || '') + '</span></div><div class="detail">' + (ep.callCount || 0) + ' call(s)</div></div>';
        });
        if (endpoints.length > 100) html += '<div class="detail">... and ' + (endpoints.length - 100) + ' more</div>';
        html += '</div>';
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = '<div class="log-box error">' + escapeHtml(e.message) + '</div>';
      }
    }

    async function loadResults() {
      const list = document.getElementById('resultsList');
      const dir = resultsDir();
      try {
        const data = await api('/api/results/list?dir=' + encodeURIComponent(dir));
        if (!data.files.length) {
          list.innerHTML = '<li class="accordion-item"><div class="accordion-head">No JSON files</div></li>';
          return;
        }
        const trashSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        list.innerHTML = data.files.map(f => '<li class="accordion-item"><div class="accordion-head" data-file="' + escapeHtml(f) + '"><span class="accordion-head-inner">' + escapeHtml(f) + '</span><button type="button" class="btn-icon btn-delete-file" title="Delete" aria-label="Delete">' + trashSvg + ' Delete</button></div><div class="accordion-body"><pre class="json-preview"></pre></div></li>').join('');
        list.querySelectorAll('.accordion-item').forEach(item => {
          const head = item.querySelector('.accordion-head');
          const inner = item.querySelector('.accordion-head-inner');
          const body = item.querySelector('.accordion-body .json-preview');
          const file = head.dataset.file;
          const deleteBtn = item.querySelector('.btn-delete-file');
          if (!file) return;
          inner.addEventListener('click', async () => {
            const wasExpanded = item.classList.contains('expanded');
            list.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('expanded'));
            if (!wasExpanded) {
              if (!body.textContent) {
                body.textContent = 'Loading...';
                try {
                  const json = await api('/api/results/file?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file));
                  body.textContent = JSON.stringify(json, null, 2);
                } catch (e) {
                  body.textContent = 'Error: ' + e.message;
                }
              }
              item.classList.add('expanded');
            }
          });
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete ' + file + '?')) return;
            try {
              const res = await fetch('/api/results/file?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file), { method: 'DELETE' });
              if (!res.ok) throw new Error(await res.text());
              item.remove();
            } catch (err) {
              alert('Delete failed: ' + (err.message || err));
            }
          });
        });
      } catch (e) {
        list.innerHTML = '<li class="accordion-item expanded"><div class="accordion-head"><span class="accordion-head-inner">Error</span></div><div class="accordion-body"><pre class="json-preview">' + escapeHtml(e.message) + '</pre></div></li>';
      }
    }

    async function loadFunctions() {
      const list = document.getElementById('functionsList');
      const dir = functionsDir();
      try {
        const data = await api('/api/functions/list?dir=' + encodeURIComponent(dir));
        if (!data.files.length) {
          list.innerHTML = '<li class="accordion-item"><div class="accordion-head">No JSON files</div></li>';
          return;
        }
        const trashSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        list.innerHTML = data.files.map(f => '<li class="accordion-item"><div class="accordion-head" data-file="' + escapeHtml(f) + '"><span class="accordion-head-inner">' + escapeHtml(f) + '</span><button type="button" class="btn-icon btn-delete-file" title="Delete" aria-label="Delete">' + trashSvg + ' Delete</button></div><div class="accordion-body"><pre class="json-preview"></pre></div></li>').join('');
        list.querySelectorAll('.accordion-item').forEach(item => {
          const head = item.querySelector('.accordion-head');
          const inner = item.querySelector('.accordion-head-inner');
          const body = item.querySelector('.accordion-body .json-preview');
          const file = head.dataset.file;
          const deleteBtn = item.querySelector('.btn-delete-file');
          if (!file) return;
          inner.addEventListener('click', async () => {
            const wasExpanded = item.classList.contains('expanded');
            list.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('expanded'));
            if (!wasExpanded) {
              if (!body.textContent) {
                body.textContent = 'Loading...';
                try {
                  const json = await api('/api/functions/file?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file));
                  body.textContent = JSON.stringify(json, null, 2);
                } catch (e) {
                  body.textContent = 'Error: ' + e.message;
                }
              }
              item.classList.add('expanded');
            }
          });
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete ' + file + '?')) return;
            try {
              const res = await fetch('/api/functions/file?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file), { method: 'DELETE' });
              if (!res.ok) throw new Error(await res.text());
              item.remove();
            } catch (err) {
              alert('Delete failed: ' + (err.message || err));
            }
          });
        });
      } catch (e) {
        list.innerHTML = '<li class="accordion-item expanded"><div class="accordion-head"><span class="accordion-head-inner">Error</span></div><div class="accordion-body"><pre class="json-preview">' + escapeHtml(e.message) + '</pre></div></li>';
      }
    }

    async function loadActions() {
      const list = document.getElementById('actionsList');
      const dir = actionsDir();
      try {
        const data = await api('/api/actions/list?dir=' + encodeURIComponent(dir));
        if (!data.files.length) {
          list.innerHTML = '<li class="accordion-item"><div class="accordion-head">No JSON files</div></li>';
          return;
        }
        const trashSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        list.innerHTML = data.files.map(f => '<li class="accordion-item"><div class="accordion-head" data-file="' + escapeHtml(f) + '"><span class="accordion-head-inner">' + escapeHtml(f) + '</span><button type="button" class="btn-icon btn-delete-file" title="Delete" aria-label="Delete">' + trashSvg + ' Delete</button></div><div class="accordion-body"><pre class="json-preview"></pre></div></li>').join('');
        list.querySelectorAll('.accordion-item').forEach(item => {
          const head = item.querySelector('.accordion-head');
          const inner = item.querySelector('.accordion-head-inner');
          const body = item.querySelector('.accordion-body .json-preview');
          const file = head.dataset.file;
          const deleteBtn = item.querySelector('.btn-delete-file');
          if (!file) return;
          inner.addEventListener('click', async () => {
            const wasExpanded = item.classList.contains('expanded');
            list.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('expanded'));
            if (!wasExpanded) {
              if (!body.textContent) {
                body.textContent = 'Loading...';
                try {
                  const json = await api('/api/actions/file?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file));
                  body.textContent = JSON.stringify(json, null, 2);
                } catch (e) {
                  body.textContent = 'Error: ' + e.message;
                }
              }
              item.classList.add('expanded');
            }
          });
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete ' + file + '?')) return;
            try {
              const res = await fetch('/api/actions/file?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file), { method: 'DELETE' });
              if (!res.ok) throw new Error(await res.text());
              item.remove();
            } catch (err) {
              alert('Delete failed: ' + (err.message || err));
            }
          });
        });
      } catch (e) {
        list.innerHTML = '<li class="accordion-item expanded"><div class="accordion-head"><span class="accordion-head-inner">Error</span></div><div class="accordion-body"><pre class="json-preview">' + escapeHtml(e.message) + '</pre></div></li>';
      }
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function setRunLog(text, isError) {
      const el = document.getElementById('runLog');
      el.textContent = text || '';
      el.className = 'log-box' + (isError ? ' error' : ' success');
      el.scrollTop = el.scrollHeight;
    }

    const runButtons = ['runScan', 'runValidate', 'runActions', 'runUpload'];
    const stopBtns = [document.getElementById('runStop'), document.getElementById('runStopScan'), document.getElementById('runStopValidate'), document.getElementById('runStopActions')];

    function setRunning(running) {
      runButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = running;
      });
      stopBtns.forEach(btn => { if (btn) btn.classList.toggle('hidden', !running); });
    }

    async function runCommand(body) {
      setRunLog('', false);
      setRunning(true);
      try {
        const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) {
          setRunLog('Request failed: ' + res.status, true);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          setRunLog(fullText, false);
        }
        const exitMatch = fullText.match(/__EXIT__:(\\d+|null)\\s*$/);
        let code = 1;
        let logText = fullText;
        if (exitMatch) {
          logText = fullText.replace(/\\n?__EXIT__:(\\d+|null)\\s*$/, '');
          code = exitMatch[1] === 'null' ? 1 : parseInt(exitMatch[1], 10);
        }
        setRunLog(logText.trim() || '(no output)', code !== 0);
        if (code === 0) {
          if (body.command === 'scan') { loadScan(); loadResults(); }
          if (body.command === 'validate-functions' || body.command === 'actions') loadFunctions();
          if (body.command === 'actions' || body.command === 'upload-actions') loadActions();
        }
      } catch (e) {
        setRunLog(e.message, true);
      } finally {
        setRunning(false);
      }
    }

    function onStopClick() {
      fetch('/api/run/stop', { method: 'POST' }).then(res => res.json()).then(data => {
        if (data.stopped) setRunLog((document.getElementById('runLog').textContent || '') + '\\n[Stopped by user]', true);
      }).catch(e => {
        setRunLog((document.getElementById('runLog').textContent || '') + '\\nStop failed: ' + e.message, true);
      });
    }
    document.getElementById('runStop').addEventListener('click', onStopClick);
    document.getElementById('runStopScan').addEventListener('click', onStopClick);
    document.getElementById('runStopValidate').addEventListener('click', onStopClick);
    document.getElementById('runStopActions').addEventListener('click', onStopClick);

    document.getElementById('refreshScan').addEventListener('click', loadScan);
    document.getElementById('refreshResults').addEventListener('click', loadResults);
    document.getElementById('refreshActions').addEventListener('click', loadActions);
    document.getElementById('refreshFunctions').addEventListener('click', loadFunctions);

    document.getElementById('deleteAllResults').addEventListener('click', async () => {
      if (!confirm('Delete all result JSON files in ' + resultsDir() + '? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/results/all?dir=' + encodeURIComponent(resultsDir()), { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        loadResults();
      } catch (err) {
        alert('Delete all failed: ' + (err.message || err));
      }
    });
    document.getElementById('deleteAllFunctions').addEventListener('click', async () => {
      if (!confirm('Delete all function JSON files in ' + functionsDir() + '? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/functions/all?dir=' + encodeURIComponent(functionsDir()), { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        loadFunctions();
      } catch (err) {
        alert('Delete all failed: ' + (err.message || err));
      }
    });
    document.getElementById('deleteAllActions').addEventListener('click', async () => {
      if (!confirm('Delete all action JSON files in ' + actionsDir() + '? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/actions/all?dir=' + encodeURIComponent(actionsDir()), { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        loadActions();
      } catch (err) {
        alert('Delete all failed: ' + (err.message || err));
      }
    });

    document.getElementById('runScan').addEventListener('click', () => runCommand({
      command: 'scan',
      scanDir: scanDir(),
      outputPath: scanOutputPath(),
      functionCodeDir: functionsDir()
    }));
    document.getElementById('runValidate').addEventListener('click', () => runCommand({
      command: 'validate-functions',
      functionsDir: functionsDir(),
      fix: document.getElementById('validateFix').checked
    }));
    document.getElementById('runActions').addEventListener('click', () => runCommand({
      command: 'actions',
      actionsInputDir: functionsDir(),
      actionsOutputDir: actionsDir(),
      appName: appName(),
      serviceKey: serviceKey() || undefined
    }));
    document.getElementById('runUpload').addEventListener('click', () => runCommand({
      command: 'upload-actions',
      actionsOutputDir: actionsDir()
    }));

    loadScan();
    loadResults();
    loadFunctions();
    loadActions();
  </script>
</body>
</html>`;
