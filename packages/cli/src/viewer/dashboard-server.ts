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
  onProc: (proc: ChildProcess | null) => void,
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
  options: DashboardServerOptions = {},
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
          query.path || "results/restoinspect.json",
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
            }),
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
            }),
          );
        }
        return;
      }

      if (pathname === "/api/functions/file") {
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
            }),
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
            }),
          );
        }
        return;
      }

      if (pathname === "/api/actions/file") {
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
            }),
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
            JSON.stringify({ stopped: false, message: "No process running" }),
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
        }),
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
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f0f12; color: #e4e4e7; line-height: 1.5; min-height: 100vh; }
    .app { max-width: 1400px; margin: 0 auto; padding: 24px; }
    header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #27272a; }
    h1 { font-size: 1.5rem; font-weight: 600; }
    .tabs { display: flex; gap: 4px; margin-bottom: 20px; }
    .tabs button { padding: 10px 18px; border: none; border-radius: 8px; background: #27272a; color: #a1a1aa; cursor: pointer; font-size: 14px; }
    .tabs button:hover { background: #3f3f46; color: #fff; }
    .tabs button.active { background: #3b82f6; color: #fff; }
    .panel { display: none; background: #18181b; border-radius: 12px; border: 1px solid #27272a; overflow: hidden; }
    .panel.active { display: block; }
    .panel-header { padding: 16px 20px; border-bottom: 1px solid #27272a; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .panel-header h2 { font-size: 1rem; font-weight: 600; }
    .panel-body { padding: 20px; max-height: 60vh; overflow: auto; }
    .actions-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .btn { padding: 10px 18px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #27272a; color: #e4e4e7; }
    .btn-secondary:hover { background: #3f3f46; }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.hidden { display: none; }
    .log-box { background: #0f0f12; border: 1px solid #27272a; border-radius: 8px; padding: 16px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 280px; overflow: auto; margin-top: 16px; }
    .log-box.success { border-color: #22c55e; }
    .log-box.error { border-color: #ef4444; }
    .file-list { list-style: none; }
    .file-list li { padding: 12px 16px; border-bottom: 1px solid #27272a; display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
    .file-list li:hover { background: #27272a; }
    .file-list li:last-child { border-bottom: none; }
    .endpoint { padding: 14px 16px; border-bottom: 1px solid #27272a; }
    .endpoint:last-child { border-bottom: none; }
    .endpoint-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .method { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .method.get { background: #1e3a5f; color: #93c5fd; }
    .method.post { background: #14532d; color: #86efac; }
    .method.put { background: #78350f; color: #fcd34d; }
    .method.delete { background: #7f1d1d; color: #fca5a5; }
    .url { font-family: ui-monospace, monospace; font-size: 13px; color: #a1a1aa; }
    .detail { font-size: 12px; color: #71717a; margin-top: 8px; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .stat { padding: 12px 16px; background: #27272a; border-radius: 8px; }
    .stat strong { display: block; font-size: 1.25rem; color: #3b82f6; }
    .json-preview { background: #0f0f12; border-radius: 8px; padding: 16px; font-size: 12px; overflow: auto; max-height: 400px; }
    .inputs { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .inputs label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #a1a1aa; }
    .inputs input { padding: 8px 12px; border-radius: 6px; border: 1px solid #27272a; background: #27272a; color: #e4e4e7; width: 200px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <h1>API Surface Dashboard</h1>
      <div class="inputs">
        <label>Repo to scan: <input type="text" id="scanDir" value="." placeholder="e.g. . or ./src" title="Directory to scan for API calls" /></label>
        <label>Scan output: <input type="text" id="scanOutputPath" value="results/restoinspect.json" /></label>
        <label>Functions dir: <input type="text" id="functionsDir" value="functions/resto-inspect" /></label>
        <label>Actions dir: <input type="text" id="actionsDir" value="actions/resto-inspect" /></label>
        <label>App name: <input type="text" id="appName" value="resto-inspect" placeholder="e.g. resto-inspect" /></label>
      </div>
    </header>

    <div class="tabs">
      <button type="button" class="active" data-tab="scan">Scan Results</button>
      <button type="button" data-tab="functions">Functions</button>
      <button type="button" data-tab="actions">Actions</button>
      <button type="button" data-tab="run">Run Commands</button>
    </div>

    <div id="panel-scan" class="panel active">
      <div class="panel-header"><h2>Scan Results</h2><button type="button" class="btn btn-secondary" id="refreshScan">Refresh</button></div>
      <div class="panel-body" id="scanBody"><div class="log-box">Loading...</div></div>
    </div>

    <div id="panel-functions" class="panel">
      <div class="panel-header"><h2>Function JSON files</h2><button type="button" class="btn btn-secondary" id="refreshFunctions">Refresh</button></div>
      <div class="panel-body"><ul class="file-list" id="functionsList"></ul><div class="json-preview" id="functionsPreview" style="display:none; margin-top:12px;"></div></div>
    </div>

    <div id="panel-actions" class="panel">
      <div class="panel-header"><h2>Action JSON files</h2><button type="button" class="btn btn-secondary" id="refreshActions">Refresh</button></div>
      <div class="panel-body"><ul class="file-list" id="actionsList"></ul><div class="json-preview" id="actionsPreview" style="display:none; margin-top:12px;"></div></div>
    </div>

    <div id="panel-run" class="panel">
      <div class="panel-header"><h2>Run commands</h2></div>
      <div class="panel-body">
        <div class="actions-bar">
          <button type="button" class="btn btn-primary" id="runScan">Scan</button>
          <button type="button" class="btn btn-primary" id="runValidate">Validate functions</button>
          <button type="button" class="btn btn-primary" id="runActions">Generate actions</button>
          <button type="button" class="btn btn-primary" id="runUpload">Upload actions</button>
          <button type="button" class="btn btn-danger hidden" id="runStop">Stop</button>
          <label><input type="checkbox" id="validateFix" /> Validate with --fix</label>
        </div>
        <div class="log-box" id="runLog">Output will appear here after running a command.</div>
      </div>
    </div>
  </div>

  <script>
    const scanDir = () => document.getElementById('scanDir').value.trim() || '.';
    const scanOutputPath = () => document.getElementById('scanOutputPath').value;
    const functionsDir = () => document.getElementById('functionsDir').value;
    const actionsDir = () => document.getElementById('actionsDir').value;
    const appName = () => document.getElementById('appName').value;

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

    async function loadFunctions() {
      const list = document.getElementById('functionsList');
      const preview = document.getElementById('functionsPreview');
      preview.style.display = 'none';
      try {
        const data = await api('/api/functions/list?dir=' + encodeURIComponent(functionsDir()));
        list.innerHTML = data.files.length ? data.files.map(f => '<li data-file="' + escapeHtml(f) + '">' + escapeHtml(f) + '</li>').join('') : '<li>No JSON files</li>';
        list.querySelectorAll('li[data-file]').forEach(li => {
          li.addEventListener('click', async () => {
            const file = li.dataset.file;
            const json = await api('/api/functions/file?dir=' + encodeURIComponent(functionsDir()) + '&file=' + encodeURIComponent(file));
            preview.style.display = 'block';
            preview.textContent = JSON.stringify(json, null, 2);
          });
        });
      } catch (e) {
        list.innerHTML = '<li class="log-box error">' + escapeHtml(e.message) + '</li>';
      }
    }

    async function loadActions() {
      const list = document.getElementById('actionsList');
      const preview = document.getElementById('actionsPreview');
      preview.style.display = 'none';
      try {
        const data = await api('/api/actions/list?dir=' + encodeURIComponent(actionsDir()));
        list.innerHTML = data.files.length ? data.files.map(f => '<li data-file="' + escapeHtml(f) + '">' + escapeHtml(f) + '</li>').join('') : '<li>No JSON files</li>';
        list.querySelectorAll('li[data-file]').forEach(li => {
          li.addEventListener('click', async () => {
            const file = li.dataset.file;
            const json = await api('/api/actions/file?dir=' + encodeURIComponent(actionsDir()) + '&file=' + encodeURIComponent(file));
            preview.style.display = 'block';
            preview.textContent = JSON.stringify(json, null, 2);
          });
        });
      } catch (e) {
        list.innerHTML = '<li class="log-box error">' + escapeHtml(e.message) + '</li>';
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
    const stopBtn = document.getElementById('runStop');

    function setRunning(running) {
      runButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = running;
      });
      if (stopBtn) stopBtn.classList.toggle('hidden', !running);
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
          if (body.command === 'scan') loadScan();
          if (body.command === 'validate-functions' || body.command === 'actions') loadFunctions();
          if (body.command === 'actions' || body.command === 'upload-actions') loadActions();
        }
      } catch (e) {
        setRunLog(e.message, true);
      } finally {
        setRunning(false);
      }
    }

    stopBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/run/stop', { method: 'POST' });
        const data = await res.json();
        if (data.stopped) setRunLog((document.getElementById('runLog').textContent || '') + '\\n[Stopped by user]', true);
      } catch (e) {
        setRunLog((document.getElementById('runLog').textContent || '') + '\\nStop failed: ' + e.message, true);
      }
    });

    document.getElementById('refreshScan').addEventListener('click', loadScan);
    document.getElementById('refreshActions').addEventListener('click', loadActions);
    document.getElementById('refreshFunctions').addEventListener('click', loadFunctions);

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
      appName: appName()
    }));
    document.getElementById('runUpload').addEventListener('click', () => runCommand({
      command: 'upload-actions',
      actionsOutputDir: actionsDir()
    }));

    loadScan();
    loadFunctions();
    loadActions();
  </script>
</body>
</html>`;
