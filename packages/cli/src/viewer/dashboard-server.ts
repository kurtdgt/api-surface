/**
 * Dashboard server: UI to view scan results, functions, actions and run CLI commands via buttons.
 */

import { spawn, type ChildProcess } from "child_process";
import { config as loadEnv } from "dotenv";
import * as fs from "fs/promises";
import * as http from "http";
import open from "open";
import * as path from "path";
import * as url from "url";
import { generatePrismaSqlFromSchema } from "../commands/generate-prisma-sql";
import { suggestTestPayload } from "../commands/suggest-test-payload";

const EXECUTE_BASE_URL =
  "https://refreshing-amazement-production.up.railway.app/api/v2/execute";

/** Fixed URL for adding system parameters (admin API). */
const SYSTEM_PARAMETERS_API_URL =
  "https://refreshing-amazement-production.up.railway.app/api/admin/system-parameters";

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
        const dir = resolvePath(cwd, query.dir || "functions/");
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

      if (pathname === "/api/functions/file" && req.method !== "DELETE") {
        const dir = resolvePath(cwd, query.dir || "functions/");
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
        const dir = resolvePath(cwd, query.dir || "actions/");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name)
            .sort();
          const fileMeta: Record<
            string,
            {
              uploaded: boolean;
              uploadedAt?: string;
              working: boolean;
              workingAt?: string;
            }
          > = {};
          for (const file of files) {
            try {
              const raw = await fs.readFile(path.join(dir, file), "utf-8");
              const obj = JSON.parse(raw) as Record<string, unknown>;
              const uploaded = obj.uploaded === true;
              const uploadedAt =
                typeof obj.uploadedAt === "string" ? obj.uploadedAt : undefined;
              const working = obj.working === true;
              const workingAt =
                typeof obj.workingAt === "string" ? obj.workingAt : undefined;
              fileMeta[file] = { uploaded, uploadedAt, working, workingAt };
            } catch {
              fileMeta[file] = { uploaded: false, working: false };
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ dir, files, fileMeta }));
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

      if (pathname === "/api/actions/endpoints") {
        const dir = resolvePath(cwd, query.dir || "actions/");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name)
            .sort();
          const endpoints: Array<{
            file: string;
            serviceKey: string;
            actionName: string;
            displayName?: string;
            uploaded?: boolean;
            uploadedAt?: string;
            working?: boolean;
            workingAt?: string;
          }> = [];
          for (const file of files) {
            try {
              const raw = await fs.readFile(path.join(dir, file), "utf-8");
              const obj = JSON.parse(raw) as Record<string, unknown>;
              const serviceKey =
                typeof obj.serviceKey === "string" ? obj.serviceKey : "";
              const actionName =
                typeof obj.actionName === "string" ? obj.actionName : "";
              const displayName =
                typeof obj.displayName === "string"
                  ? obj.displayName
                  : undefined;
              const uploaded = obj.uploaded === true;
              const uploadedAt =
                typeof obj.uploadedAt === "string" ? obj.uploadedAt : undefined;
              const working = obj.working === true;
              const workingAt =
                typeof obj.workingAt === "string" ? obj.workingAt : undefined;
              if (serviceKey && actionName) {
                endpoints.push({
                  file,
                  serviceKey,
                  actionName,
                  displayName,
                  uploaded,
                  uploadedAt,
                  working,
                  workingAt,
                });
              }
            } catch {
              // skip invalid files
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ dir, endpoints }));
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

      if (pathname === "/api/actions/file" && req.method !== "DELETE") {
        const dir = resolvePath(cwd, query.dir || "actions/");
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

      if (pathname === "/api/functions/file" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "functions/");
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
            }),
          );
        }
        return;
      }

      if (pathname === "/api/functions/all" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "functions/");
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
            }),
          );
        }
        return;
      }

      if (pathname === "/api/actions/file" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "actions/");
        const file = query.file;
        if (!file || file.includes("..") || !file.endsWith(".json")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid file" }));
          return;
        }
        const filePath = path.join(dir, file);
        try {
          await fs.unlink(filePath);
          const remarksPath = path.join(dir, "remarks.json");
          try {
            const content = await fs.readFile(remarksPath, "utf-8");
            const remarks = JSON.parse(content) as Record<string, string>;
            if (remarks && typeof remarks === "object" && file in remarks) {
              delete remarks[file];
              await fs.writeFile(
                remarksPath,
                JSON.stringify(remarks, null, 2),
                "utf-8",
              );
            }
          } catch {
            /* ignore */
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: file }));
        } catch (e) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete failed",
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (pathname === "/api/actions/all" && req.method === "DELETE") {
        const dir = resolvePath(cwd, query.dir || "actions/");
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile() && e.name.endsWith(".json"))
            .map((e) => e.name);
          for (const file of files) {
            await fs.unlink(path.join(dir, file));
          }
          const remarksPath = path.join(dir, "remarks.json");
          try {
            await fs.unlink(remarksPath);
          } catch {
            /* ignore */
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ deleted: files.length, files }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Delete all failed",
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (pathname === "/api/actions/remarks" && req.method === "GET") {
        const dir = resolvePath(cwd, (query.dir || "actions/").trim());
        const remarksPath = path.join(dir, "remarks.json");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        try {
          const content = await fs.readFile(remarksPath, "utf-8");
          const raw = JSON.parse(content);
          if (typeof raw !== "object" || raw === null) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ remarks: {} }));
            return;
          }
          const remarks: Record<string, { remark: string; resolved: boolean }> =
            {};
          for (const [k, v] of Object.entries(raw)) {
            if (typeof v === "string") {
              remarks[k] = { remark: v, resolved: false };
            } else if (v && typeof v === "object" && "remark" in v) {
              const o = v as { remark?: string; resolved?: boolean };
              remarks[k] = {
                remark: typeof o.remark === "string" ? o.remark : "",
                resolved: Boolean(o.resolved),
              };
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ remarks }));
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ remarks: {} }));
            return;
          }
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
        return;
      }

      if (pathname === "/api/actions/remarks" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        try {
          const params = JSON.parse(body || "{}") as {
            dir?: string;
            file?: string;
            remark?: string;
            resolved?: boolean;
          };
          const dir = resolvePath(cwd, (params.dir || "actions/").trim());
          const file =
            typeof params.file === "string" ? params.file.trim() : "";
          if (!file || file.includes("..") || !file.endsWith(".json")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid file" }));
            return;
          }
          const remarksPath = path.join(dir, "remarks.json");
          type RemarkEntry = string | { remark: string; resolved: boolean };
          let rawRemarks: Record<string, RemarkEntry> = {};
          try {
            const content = await fs.readFile(remarksPath, "utf-8");
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object") rawRemarks = parsed;
          } catch {
            /* missing or invalid: start fresh */
          }
          const current = rawRemarks[file];
          let remark =
            typeof current === "string"
              ? current
              : current && typeof current === "object"
                ? (current as { remark: string }).remark || ""
                : "";
          let resolved =
            typeof current === "object" && current && "resolved" in current
              ? Boolean((current as { resolved?: boolean }).resolved)
              : false;
          function toEntry(v: RemarkEntry): {
            remark: string;
            resolved: boolean;
          } {
            if (typeof v === "string") return { remark: v, resolved: false };
            const o = v as { remark?: string; resolved?: boolean };
            return {
              remark: typeof o.remark === "string" ? o.remark : "",
              resolved: Boolean(o.resolved),
            };
          }
          if (params.remark !== undefined) {
            if (params.remark === "") {
              await fs.mkdir(dir, { recursive: true });
              const next: Record<
                string,
                { remark: string; resolved: boolean }
              > = {};
              for (const [k, v] of Object.entries(rawRemarks)) {
                if (k === file) continue;
                next[k] = toEntry(v);
              }
              await fs.writeFile(
                remarksPath,
                JSON.stringify(next, null, 2),
                "utf-8",
              );
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, remarks: next }));
              return;
            }
            remark = params.remark;
          }
          if (params.resolved !== undefined) resolved = params.resolved;
          const next: Record<string, { remark: string; resolved: boolean }> =
            {};
          for (const [k, v] of Object.entries(rawRemarks)) {
            if (k === file) continue;
            next[k] = toEntry(v);
          }
          next[file] = { remark, resolved };
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(
            remarksPath,
            JSON.stringify(next, null, 2),
            "utf-8",
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, remarks: next }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (
        pathname === "/api/actions/uploaded" &&
        (req.method === "POST" || req.method === "PATCH")
      ) {
        let body = "";
        for await (const chunk of req) body += chunk;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        try {
          const params = JSON.parse(body || "{}") as {
            dir?: string;
            file?: string;
            uploaded?: boolean;
          };
          const dir = resolvePath(cwd, (params.dir || "actions/").trim());
          const file =
            typeof params.file === "string" ? params.file.trim() : "";
          if (!file || file.includes("..") || !file.endsWith(".json")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid file" }));
            return;
          }
          const uploaded = params.uploaded === true;
          const filePath = path.join(dir, file);
          const raw = await fs.readFile(filePath, "utf-8");
          const obj = JSON.parse(raw) as Record<string, unknown>;
          obj.uploaded = uploaded;
          if (uploaded) {
            obj.uploadedAt = new Date().toISOString();
          } else {
            delete obj.uploadedAt;
          }
          await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              file,
              uploaded,
              uploadedAt: obj.uploadedAt ?? undefined,
            }),
          );
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (
        pathname === "/api/actions/working" &&
        (req.method === "POST" || req.method === "PATCH")
      ) {
        let body = "";
        for await (const chunk of req) body += chunk;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        try {
          const params = JSON.parse(body || "{}") as {
            dir?: string;
            file?: string;
            working?: boolean;
          };
          const dir = resolvePath(cwd, (params.dir || "actions/").trim());
          const file =
            typeof params.file === "string" ? params.file.trim() : "";
          if (!file || file.includes("..") || !file.endsWith(".json")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid file" }));
            return;
          }
          const working = params.working === true;
          const filePath = path.join(dir, file);
          const raw = await fs.readFile(filePath, "utf-8");
          const obj = JSON.parse(raw) as Record<string, unknown>;
          obj.working = working;
          if (working) {
            obj.workingAt = new Date().toISOString();
          } else {
            delete obj.workingAt;
          }
          await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              file,
              working,
              workingAt: obj.workingAt ?? undefined,
            }),
          );
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (
        pathname === "/api/actions/bulk-update-service-key" &&
        req.method === "POST"
      ) {
        let body = "";
        for await (const chunk of req) body += chunk;
        let params: { dir?: string; files?: string[]; serviceKey?: string };
        try {
          params = JSON.parse(body || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        const dir = resolvePath(cwd, params.dir || "actions/");
        const files = Array.isArray(params.files) ? params.files : [];
        const serviceKey =
          typeof params.serviceKey === "string" ? params.serviceKey.trim() : "";
        if (!serviceKey) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "serviceKey is required" }));
          return;
        }
        if (files.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "At least one file is required" }));
          return;
        }
        const failed: string[] = [];
        let updated = 0;
        for (const file of files) {
          if (!file || file.includes("..") || !file.endsWith(".json")) {
            failed.push(file || "(empty)");
            continue;
          }
          const filePath = path.join(dir, file);
          try {
            const raw = await fs.readFile(filePath, "utf-8");
            const obj = JSON.parse(raw) as Record<string, unknown>;
            obj.serviceKey = serviceKey;
            await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf-8");
            updated++;
          } catch {
            failed.push(file);
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            updated,
            failed: failed.length ? failed : undefined,
          }),
        );
        return;
      }

      if (pathname === "/api/proxy/system-parameters" && req.method === "GET") {
        try {
          const proxyRes = await fetch(SYSTEM_PARAMETERS_API_URL);
          const text = await proxyRes.text();
          res.writeHead(proxyRes.status, {
            "Content-Type": "application/json",
          });
          res.end(text || "{}");
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Failed to fetch system parameters",
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (
        pathname === "/api/proxy/system-parameters" &&
        req.method === "POST"
      ) {
        let body = "";
        for await (const chunk of req) body += chunk;
        let params: { payload?: Record<string, unknown> };
        try {
          params = JSON.parse(body || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        const payload =
          params.payload && typeof params.payload === "object"
            ? params.payload
            : null;
        if (!payload) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "payload is required" }));
          return;
        }
        const targetUrl = SYSTEM_PARAMETERS_API_URL;
        try {
          const proxyRes = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const text = await proxyRes.text();
          let jsonBody: unknown = { ok: proxyRes.ok };
          if (text) {
            try {
              jsonBody = JSON.parse(text);
            } catch {
              jsonBody = { ok: proxyRes.ok, body: text };
            }
          }
          res.writeHead(proxyRes.status, {
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify(jsonBody));
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Proxy request failed",
              message: e instanceof Error ? e.message : String(e),
            }),
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
            }),
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
            }),
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
            }),
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
            }),
          );
        }
        return;
      }

      if (pathname === "/api/test/suggest-payload" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          const { actionJson } = JSON.parse(body || "{}") as {
            actionJson?: Record<string, unknown>;
          };
          if (!actionJson || typeof actionJson !== "object") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "actionJson required" }));
            return;
          }
          const result = await suggestTestPayload(actionJson);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (pathname === "/api/prisma-to-sql" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        try {
          const params = JSON.parse(body || "{}") as { repoPath?: string };
          const repoPath = (params.repoPath || ".").trim();
          const schemaPath = path.join(
            resolvePath(cwd, repoPath),
            "prisma",
            "schema.prisma",
          );
          const schemaContent = await fs.readFile(schemaPath, "utf-8");
          loadEnv();
          const anthropicKey = process.env.ANTHROPIC_API_KEY;
          const openaiKey = process.env.OPENAI_API_KEY;
          const result = await generatePrismaSqlFromSchema(schemaContent, {
            anthropicKey,
            openaiKey,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ sql: result.sql }));
        } catch (e) {
          const code =
            (e as NodeJS.ErrnoException)?.code === "ENOENT" ? 404 : 500;
          res.writeHead(code, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (pathname === "/api/test/execute" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          const params = JSON.parse(body || "{}") as {
            url: string;
            method?: string;
            body?: string;
            queryParams?: Record<string, string>;
          };
          const {
            url: targetUrl,
            method = "POST",
            body: reqBody,
            queryParams,
          } = params;
          if (!targetUrl || typeof targetUrl !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "url required" }));
            return;
          }
          let urlToFetch = targetUrl;
          if (
            queryParams &&
            typeof queryParams === "object" &&
            Object.keys(queryParams).length > 0
          ) {
            const sp = new url.URL(targetUrl);
            for (const [k, v] of Object.entries(queryParams)) {
              if (v != null && v !== "") sp.searchParams.set(k, String(v));
            }
            urlToFetch = sp.toString();
          }
          const fetchRes = await fetch(urlToFetch, {
            method: method || "POST",
            headers: { "Content-Type": "application/json" },
            body: reqBody != null && reqBody !== "" ? reqBody : undefined,
          });
          const responseBody = await fetchRes.text();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: fetchRes.status,
              statusText: fetchRes.statusText,
              ok: fetchRes.ok,
              body: responseBody,
            }),
          );
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return;
      }

      if (pathname === "/api/tested" && req.method === "GET") {
        const filePath = resolvePath(
          cwd,
          (query.path || "actions/tested.json").trim() || "actions/tested.json",
        );
        setCors();
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const data = JSON.parse(content);
          if (typeof data !== "object" || data === null) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({}));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({}));
            return;
          }
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
        return;
      }

      if (pathname === "/api/tested" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        setCors();
        try {
          const params = JSON.parse(body || "{}") as {
            path?: string;
            serviceKey: string;
            actionName: string;
          };
          const { path: filePathParam, serviceKey, actionName } = params;
          if (
            !serviceKey ||
            typeof serviceKey !== "string" ||
            !actionName ||
            typeof actionName !== "string"
          ) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "serviceKey and actionName are required",
              }),
            );
            return;
          }
          const filePath = resolvePath(
            cwd,
            (filePathParam || "actions/tested.json").trim() ||
              "actions/tested.json",
          );
          let data: Record<string, string[]> = {};
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object") {
              data = parsed;
            }
          } catch {
            // ENOENT or invalid JSON: start fresh
          }
          if (!Array.isArray(data[serviceKey])) {
            data[serviceKey] = [];
          }
          if (!data[serviceKey].includes(actionName)) {
            data[serviceKey].push(actionName);
          }
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, data }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
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
          apiRoutesDir?: string;
          generateActions?: boolean;
          functionsDir?: string;
          actionsInputDir?: string;
          actionsOutputDir?: string;
          appName?: string;
          serviceKey?: string;
          actionFunctionFiles?: string[];
          fix?: boolean;
          uploadUrl?: string;
          uploadFiles?: string[];
        };
        const { command } = params;
        let args: string[] = [];
        if (command === "scan") {
          const scanDir = params.scanDir || ".";
          const outputPath = params.outputPath || "results/restoinspect.json";
          const functionCodeDir = params.functionCodeDir || "functions/";
          args = [
            "scan",
            scanDir,
            "-o",
            outputPath,
            "--function-code-dir",
            functionCodeDir,
          ];
          if (params.apiRoutesDir?.trim()) {
            args.push("--api-routes-dir", params.apiRoutesDir.trim());
          }
          if (params.generateActions) {
            args.push("--generate-actions");
            if (params.actionsOutputDir?.trim()) {
              args.push("--actions-output-dir", params.actionsOutputDir.trim());
            }
          }
        } else if (command === "validate-functions") {
          const inputDir = params.functionsDir || "functions/";
          args = ["validate-functions", inputDir];
          if (params.fix) args.push("--fix");
        } else if (command === "actions") {
          const inputDir = params.actionsInputDir || "functions/";
          const outputDir = params.actionsOutputDir || "actions/";
          args = ["actions", inputDir, "-o", outputDir];
          if (params.serviceKey?.trim())
            args.push("--service-key", params.serviceKey.trim());
          if (params.appName) args.push("--name", params.appName);
          if (
            Array.isArray(params.actionFunctionFiles) &&
            params.actionFunctionFiles.length > 0
          ) {
            args.push("--functions", params.actionFunctionFiles.join(","));
          }
        } else if (command === "upload-actions") {
          const inputDir = params.actionsOutputDir || "actions/";
          args = ["upload-actions", inputDir];
          if (params.uploadUrl) args.push("--url", params.uploadUrl);
          if (params.uploadFiles?.length)
            args.push("--files", params.uploadFiles.join(","));
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
    :root { --bg: #0f0f12; --surface: #18181b; --border: #27272a; --text: #e4e4e7; --text-muted: #a1a1aa; --hover: #27272a; --hover-strong: #3f3f46; --code-bg: #0f0f12; --stat-bg: #27272a; --arrow: #71717a; }
    html[data-theme="light"] { --bg: #f4f4f5; --surface: #fff; --border: #e4e4e7; --text: #18181b; --text-muted: #71717a; --hover: #f4f4f5; --hover-strong: #e4e4e7; --code-bg: #fafafa; --stat-bg: #f4f4f5; --arrow: #71717a; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; min-height: 100vh; transition: background 0.2s, color 0.2s; margin: 0; }
    .app { max-width: 1400px; margin: 0 auto; padding: 32px 28px; display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; gap: 0; }
    .panels-wrap { flex: 1; min-height: 0; overflow: auto; padding-top: 4px; }
    .command-output { flex-shrink: 0; border-top: 1px solid var(--border); margin-top: 20px; padding: 20px 24px; background: var(--surface); border-radius: 10px; }
    .command-output-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .command-output-header h3 { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0; }
    .command-output .log-box { max-height: 180px; margin-top: 0; }
    .test-config-actions { margin-top: 16px; }
    .panel-body-test { padding-top: 20px; }
    .test-form { background: var(--stat-bg); border-radius: 12px; padding: 28px; margin-bottom: 28px; border: 1px solid var(--border); }
    .test-form-section { margin-bottom: 24px; }
    .test-form-section:last-child { margin-bottom: 0; }
    .test-form-section-response { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border); }
    .test-form-section-title { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 14px 0; }
    .test-form-row { margin-bottom: 16px; }
    .test-form-row:last-of-type { margin-bottom: 0; }
    .test-form-row label { display: block; font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 6px; }
    .test-form-row input, .test-form-row textarea { width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--code-bg); color: var(--text); font-family: ui-monospace, monospace; font-size: 12px; box-sizing: border-box; }
    .test-form-row textarea { min-height: 100px; resize: vertical; }
    .test-form-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
    .test-response { margin-top: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 320px; overflow: auto; min-height: 80px; }
    .test-endpoints-wrap { margin-top: 8px; }
    .test-endpoints-heading { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 12px 0; }
    .test-endpoints-list { list-style: none; margin: 0; border-radius: 10px; border: 1px solid var(--border); overflow: hidden; }
    .test-endpoints-list li { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--surface); }
    .test-endpoints-list li:last-child { border-bottom: none; }
    .test-endpoints-list li:hover { background: var(--hover); }
    .test-endpoint-info { flex: 1; min-width: 0; }
    .test-endpoint-info strong { font-size: 13px; }
    .test-endpoint-info span { font-size: 12px; color: var(--text-muted); margin-left: 8px; }
    .btn-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: btn-spin 0.6s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes btn-spin { to { transform: rotate(360deg); } }
    .btn.btn-loading { pointer-events: none; opacity: 0.85; }
    .test-subtabs { display: flex; gap: 8px; padding: 0 28px 18px; margin-bottom: 0; border-bottom: 1px solid var(--border); }
    .test-subtab { padding: 10px 20px; font-size: 13px; background: transparent; border: 1px solid transparent; border-radius: 8px; color: var(--text-muted); cursor: pointer; transition: background 0.2s, color 0.2s; }
    .test-subtab:hover { color: var(--text); background: var(--hover); }
    .test-subtab.active { color: var(--text); font-weight: 600; background: var(--surface); border-color: var(--border); }
    .test-subtab-panel.hidden { display: none; }
    .tested-intro { font-size: 13px; color: var(--text-muted); margin: 0 0 16px 0; line-height: 1.5; }
    .test-tested-bar { margin-bottom: 18px; }
    .tested-list { font-size: 13px; }
    .tested-service-group { margin-bottom: 28px; padding: 18px; background: var(--stat-bg); border-radius: 10px; border: 1px solid var(--border); }
    .tested-service-group:last-child { margin-bottom: 0; }
    .tested-service-group h4 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: 0 0 12px 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .tested-service-group ul { list-style: none; margin: 0; padding: 0; }
    .tested-service-group li { padding: 8px 0; padding-left: 14px; border-left: 3px solid var(--border); margin-left: 0; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-overlay.hidden { display: none; }
    .modal-dialog { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 28px; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
    .modal-message { margin: 0 0 24px 0; font-size: 14px; line-height: 1.55; color: var(--text); }
    .modal-actions { display: flex; gap: 12px; justify-content: flex-end; }
    header { margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
    h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
    .theme-toggle { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); cursor: pointer; font-size: 13px; }
    .theme-toggle:hover { background: var(--hover-strong); color: var(--text); }
    .theme-toggle svg { width: 18px; height: 18px; }
    .tabs { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
    .tabs button { padding: 12px 20px; border: none; border-radius: 8px; background: var(--stat-bg); color: var(--text-muted); cursor: pointer; font-size: 14px; transition: background 0.2s, color 0.2s; }
    .tabs button:hover { background: var(--hover-strong); color: var(--text); }
    .tabs button.active { background: #3b82f6; color: #fff; }
    .panel { display: none; background: var(--surface); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; transition: background 0.2s, border-color 0.2s; }
    .panel.active { display: block; }
    .panel > .panel-config { margin: 24px 28px 20px 28px; }
    .panel > .panel-config + .panel-config { margin-top: 0; }
    .panel-header { padding: 20px 28px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; }
    .panel-header h2 { font-size: 1rem; font-weight: 600; }
    .panel-body { padding: 24px 28px; max-height: 60vh; overflow: auto; }
    .panel-body > *:first-child { margin-top: 0; }
    .actions-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: var(--stat-bg); color: var(--text); }
    .btn-secondary:hover { background: var(--hover-strong); }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.hidden { display: none; }
    .hidden { display: none !important; }
    .log-box { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 20px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 280px; overflow: auto; margin-top: 20px; transition: background 0.2s, border-color 0.2s; }
    .log-box.success { border-color: #22c55e; }
    .log-box.error { border-color: #ef4444; }
    .file-list { list-style: none; }
    .file-list li { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
    .file-list li:hover { background: var(--hover); }
    .file-list li:last-child { border-bottom: none; }
    .accordion { list-style: none; }
    .accordion-item { border-bottom: 1px solid var(--border); }
    .accordion-item:last-child { border-bottom: none; }
    .accordion-head { padding: 14px 20px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; user-select: none; }
    .accordion-head:hover { background: var(--hover); }
    .accordion-head-inner { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
    .accordion-head-inner::before { content: '▶'; font-size: 10px; color: var(--arrow); transition: transform 0.2s; flex-shrink: 0; }
    .accordion-item.expanded .accordion-head-inner::before { transform: rotate(90deg); }
    .accordion-head .action-upload-cb { margin-right: 10px; flex-shrink: 0; cursor: pointer; }
    .action-uploaded-badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--success-bg, #dcfce7); color: var(--success, #16a34a); flex-shrink: 0; }
    .action-working-badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: #dbeafe; color: #2563eb; flex-shrink: 0; }
    .action-mark-uploaded-btn { font-size: 12px; padding: 4px 10px; margin-right: 6px; flex-shrink: 0; }
    .action-mark-working-btn { font-size: 12px; padding: 4px 10px; margin-right: 6px; flex-shrink: 0; }
    #actionsUploadFilter { padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--stat-bg); color: var(--text); font-size: 13px; }
    .btn-icon { padding: 6px; border: none; border-radius: 6px; background: transparent; color: var(--arrow); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .btn-icon:hover { background: var(--hover-strong); color: #ef4444; }
    .btn-icon svg { width: 16px; height: 16px; }
    .panel-header .btn-icon { padding: 8px; }
    .panel-header .btn-icon svg { width: 18px; height: 18px; }
    .accordion-body { display: none; border-top: 1px solid var(--border); overflow: hidden; }
    .accordion-item.expanded .accordion-body { display: block; }
    .accordion-body .json-preview { margin: 0; border-radius: 0; border: none; max-height: 400px; padding: 20px; }
    .action-remark-wrap { padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--stat-bg); }
    .action-remark-wrap label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
    .action-remark-wrap textarea { width: 100%; min-height: 60px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--code-bg); color: var(--text); font-size: 13px; font-family: inherit; resize: vertical; box-sizing: border-box; }
    .action-remark-actions { margin-top: 10px; }
    .remarks-card { margin: 24px 28px 24px 28px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .postman-test-panel { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .postman-base-url-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .postman-base-url-label { font-size: 12px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
    .postman-base-url-input { flex: 1; min-width: 0; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--stat-bg); color: var(--text); font-size: 12px; font-family: ui-monospace, monospace; box-sizing: border-box; }
    .postman-url-row { display: flex; align-items: stretch; gap: 0; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface); }
    .postman-method-wrap { flex-shrink: 0; }
    .postman-method-wrap select { padding: 12px 14px; border: none; background: var(--stat-bg); color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; border-right: 1px solid var(--border); min-width: 100px; }
    .postman-url-wrap { flex: 1; min-width: 0; }
    .postman-url-wrap input { width: 100%; padding: 12px 16px; border: none; background: var(--surface); color: var(--text); font-size: 13px; font-family: ui-monospace, monospace; box-sizing: border-box; }
    .postman-send-btn { border-radius: 0; margin: 0; flex-shrink: 0; }
    .postman-action-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
    .postman-action-select-wrap { min-width: 220px; }
    .postman-action-select-wrap select { padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--stat-bg); color: var(--text); font-size: 13px; width: 100%; }
    .postman-request-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .postman-tab { padding: 8px 16px; font-size: 13px; background: transparent; border: 1px solid transparent; border-radius: 6px; color: var(--text-muted); cursor: pointer; }
    .postman-tab:hover { color: var(--text); background: var(--hover); }
    .postman-tab.active { color: var(--text); font-weight: 600; background: var(--stat-bg); border-color: var(--border); }
    .postman-tab-panels { margin-bottom: 16px; }
    .postman-tab-panel { display: none; }
    .postman-tab-panel.active { display: block; }
    .postman-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
    .postman-textarea { width: 100%; min-height: 120px; padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--code-bg); color: var(--text); font-family: ui-monospace, monospace; font-size: 12px; resize: vertical; box-sizing: border-box; }
    .postman-response { border-top: 1px solid var(--border); padding-top: 16px; }
    .postman-response-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .postman-response-title { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .postman-response-status { font-size: 13px; font-weight: 600; }
    .postman-response-status.success { color: #22c55e; }
    .postman-response-status.error { color: #ef4444; }
    .postman-response-body { min-height: 100px; max-height: 280px; }
    .remarks-card .remarks-list { display: flex; flex-direction: column; gap: 12px; }
    .remarks-list-empty { font-size: 13px; color: var(--text-muted); padding: 16px; background: var(--stat-bg); border-radius: 8px; border: 1px solid var(--border); }
    .remark-item { padding: 14px 18px; background: var(--stat-bg); border-radius: 10px; border: 1px solid var(--border); }
    .remark-item.resolved .remark-item-text { text-decoration: line-through; opacity: 0.75; }
    .remark-item-file { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; font-family: ui-monospace, monospace; }
    .remark-item-text { font-size: 13px; color: var(--text-muted); line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
    .remark-item-resolved-wrap { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    .remark-item-resolved-wrap label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-muted); cursor: pointer; margin: 0; }
    .endpoint { padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .endpoint:last-child { border-bottom: none; }
    .endpoint-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .method { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .method.get { background: #1e3a5f; color: #93c5fd; }
    .method.post { background: #14532d; color: #86efac; }
    .method.put { background: #78350f; color: #fcd34d; }
    .method.delete { background: #7f1d1d; color: #fca5a5; }
    .url { font-family: ui-monospace, monospace; font-size: 13px; color: var(--text-muted); }
    .detail { font-size: 12px; color: var(--text-muted); margin-top: 8px; }
    .stats { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
    .stat { padding: 16px 20px; background: var(--stat-bg); border-radius: 10px; transition: background 0.2s; }
    .stat strong { display: block; font-size: 1.25rem; color: #3b82f6; }
    .json-preview { background: var(--code-bg); border-radius: 10px; padding: 20px; font-size: 12px; overflow: auto; max-height: 400px; white-space: pre-wrap; word-break: break-all; transition: background 0.2s; }
    .header-top { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
    .panel-config { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px 24px; margin-bottom: 20px; }
    .panel > .panel-config:last-of-type { margin-bottom: 24px; }
    .panel-config-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 12px; }
    .actions-group { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 14px; background: var(--stat-bg); border-radius: 8px; border: 1px solid var(--border); }
    .actions-group-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); white-space: nowrap; }
    .header-actions-wrap { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
    .inputs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px 28px; }
    .input-group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .input-group label { display: block; font-size: 13px; font-weight: 500; color: var(--text); margin: 0; }
    .input-group input { padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--stat-bg); color: var(--text); width: 100%; font-size: 13px; transition: background 0.2s, border-color 0.2s, color 0.2s; box-sizing: border-box; }
    .params-list-ul { list-style: none; margin: 0; padding: 0; }
    .params-item { padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .params-item:last-child { border-bottom: none; }
    .params-name { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 600; color: var(--text); }
    .params-desc { font-size: 13px; color: var(--text-muted); margin-top: 8px; line-height: 1.45; }
    .params-form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px 24px; }
    .params-form-grid .input-group.full-width { grid-column: 1 / -1; }
    .params-checkboxes { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; }
    .params-checkboxes label { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; cursor: pointer; }
    .params-form-message { font-size: 13px; margin-left: 10px; }
    .params-form-message.success { color: #22c55e; }
    .params-form-message.error { color: #ef4444; }
    .input-group select { padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--stat-bg); color: var(--text); font-size: 13px; width: 100%; max-width: 280px; cursor: pointer; }
    .prisma-sql-desc { font-size: 13px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.45; }
    .prisma-sql-desc code { background: var(--stat-bg); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .prisma-sql-output { margin-top: 16px; }
    .prisma-sql-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
    .prisma-sql-pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow: auto; margin: 0; }
    .prisma-sql-error { margin-top: 12px; padding: 12px; background: rgba(239,68,68,0.1); border: 1px solid #ef4444; border-radius: 8px; color: #ef4444; font-size: 13px; }
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
      <button type="button" data-tab="params">Params</button>
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
            <input type="text" id="scanDir" value="/Users/kurttimajo/dev/restoremasters" placeholder="e.g. /repo-name" title="Directory to scan for API calls" />
          </div>
          <div class="input-group">
            <label for="apiRoutesDir">API routes dir</label>
            <input type="text" id="apiRoutesDir" value="src/app/api" placeholder="e.g. src/app/api" title="Directory to scan: all files here and their related imports are included. With ANTHROPIC_API_KEY or OPENAI_API_KEY set, AI discovers extra dependencies so nothing is missed." />
          </div>
          <div class="input-group">
            <label for="scanOutputPath">Scan output file</label>
            <input type="text" id="scanOutputPath" value="results/restoinspect.json" title="Path to the scan result JSON file to display" />
          </div>
          <div class="input-group">
            <label for="scanFunctionCodeDir">Functions output dir</label>
            <input type="text" id="scanFunctionCodeDir" value="functions/" placeholder="e.g. functions/" title="Directory where parsed function JSON files will be written (relative to repo)" />
          </div>
          <div class="input-group">
            <label><input type="checkbox" id="scanGenerateActions" title="Generate action JSON from each endpoint after scan (includes inner routes). Requires API keys." /> Generate action JSON after scan</label>
          </div>
          <div class="input-group" id="scanActionsOutputGroup">
            <label for="scanActionsOutputDir">Actions output dir</label>
            <input type="text" id="scanActionsOutputDir" value="actions" placeholder="e.g. actions" title="Used when Generate action JSON after scan is checked" />
          </div>
        </div>
        <div class="actions-bar" style="margin-top:16px;">
          <button type="button" class="btn btn-primary" id="runScan">Scan</button>
          <button type="button" class="btn btn-secondary" id="refreshScan">Refresh</button>
        </div>
      </div>
      <div class="panel-config">
        <div class="panel-config-title">Prisma → Supabase SQL</div>
        <p class="prisma-sql-desc">Generate PostgreSQL SQL from <code>prisma/schema.prisma</code> in the repo (for Supabase SQL Editor). Requires ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.</p>
        <div class="actions-bar" style="margin-top:12px;">
          <button type="button" class="btn btn-primary" id="generatePrismaSql">Generate SQL from Prisma schema</button>
          <button type="button" class="btn btn-secondary hidden" id="copyPrismaSql" title="Copy to clipboard">Copy SQL</button>
        </div>
        <div id="prismaSqlOutput" class="prisma-sql-output hidden">
          <label class="prisma-sql-label">Generated SQL</label>
          <pre id="prismaSqlPre" class="prisma-sql-pre"></pre>
        </div>
        <div id="prismaSqlError" class="prisma-sql-error hidden"></div>
      </div>
      <div class="panel-header"><h2>Scan</h2></div>
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

    <div id="panel-params" class="panel">
      <div class="panel-config">
        <div class="panel-config-title">Display source</div>
        <div class="inputs">
          <div class="input-group">
            <label for="paramsSource">Source</label>
            <select id="paramsSource" title="Where to load the system parameters list from">
              <option value="scan">Scan result file</option>
              <option value="api">System (API)</option>
            </select>
          </div>
          <div class="input-group" id="paramsScanPathGroup">
            <label for="paramsScanPath">Scan result file path</label>
            <input type="text" id="paramsScanPath" value="results/" placeholder="Uses Scan output file from Scan tab if empty" title="Path to scan result JSON (optional when using Scan output file)" />
          </div>
        </div>
      </div>
      <div class="panel-config params-add-form">
        <div class="panel-config-title">Add system parameter</div>
        <div class="params-form-grid">
          <div class="input-group">
            <label for="paramServiceKey">serviceKey</label>
            <select id="paramServiceKey">
              <option value="rm_database">rm_database</option>
              <option value="rm_playground_database">rm_playground_database</option>
              <option value="aws">aws</option>
              <option value="twilio">twilio</option>
              <option value="google">google</option>
              <option value="__custom__">Custom...</option>
            </select>
            <input type="text" id="paramServiceKeyCustom" placeholder="Enter custom serviceKey" style="display:none; margin-top:6px;" />
          </div>
          <div class="input-group">
            <label for="paramParamKey">paramKey</label>
            <input type="text" id="paramParamKey" placeholder="e.g. MONDAY_API_KEY" required />
          </div>
          <div class="input-group">
            <label for="paramParamValue">paramValue</label>
            <input type="text" id="paramParamValue" placeholder="your-api-key-here" />
          </div>
          <div class="input-group">
            <label for="paramDisplayName">displayName</label>
            <input type="text" id="paramDisplayName" placeholder="e.g. Monday.com API Key" />
          </div>
          <div class="input-group">
            <label for="paramDescription">description</label>
            <input type="text" id="paramDescription" placeholder="e.g. API key for Monday.com authentication" />
          </div>
          <div class="input-group">
            <label for="paramCategory">category</label>
            <select id="paramCategory">
              <option value="">—</option>
              <option value="authentication">authentication</option>
              <option value="configuration">configuration</option>
              <option value="integration">integration</option>
              <option value="webhook">webhook</option>
              <option value="storage">storage</option>
              <option value="communication">communication</option>
            </select>
          </div>
          <div class="input-group">
            <label for="paramTenant">Tenant</label>
            <select id="paramTenant">
              <option value="1">RestoreMasters</option>
              <option value="null">Global</option>
              <option value="__custom__">Custom...</option>
            </select>
            <input type="text" id="paramTenantCustom" placeholder="Enter custom tenant" style="display:none; margin-top:6px;" />
          </div>
          <div class="input-group params-checkboxes">
            <label><input type="checkbox" id="paramIsRequired" /> isRequired</label>
            <label><input type="checkbox" id="paramIsEncrypted" /> isEncrypted</label>
          </div>
        </div>
        <div class="actions-bar actions-bar-top" style="margin-top:16px;">
          <button type="button" class="btn btn-primary" id="paramSubmit">Add system parameter</button>
          <span id="paramFormMessage" class="params-form-message"></span>
        </div>
      </div>
      <div class="panel-header"><h2>System parameters</h2><div class="actions-bar"><button type="button" class="btn btn-secondary" id="refreshParams">Refresh</button></div></div>
      <div class="panel-body"><div id="paramsList" class="params-list">Load scan result to show required system parameters. Uses the Scan output file path from the Scan tab.</div></div>
    </div>

    <div id="panel-functions" class="panel">
      <div class="panel-config">
        <div class="panel-config-title">Functions directory</div>
        <div class="inputs">
          <div class="input-group">
            <label for="functionsDir">Functions dir</label>
            <input type="text" id="functionsDir" value="functions/" placeholder="e.g. functions/repo-name" title="Directory containing function JSON files (input for validate & generate actions)" />
          </div>
        </div>
        <div class="panel-config-title">Generate actions</div>
        <div class="inputs">
          <div class="input-group">
            <label for="actionsDir">Actions output dir</label>
            <input type="text" id="actionsDir" value="actions/" placeholder="e.g. actions/repo-name" title="Output directory for generated action JSON files" />
          </div>
          <div class="input-group">
            <label for="appName">App name</label>
            <input type="text" id="appName" value="resto-inspect" placeholder="e.g. resto-inspect" title="Used in generated action names" />
          </div>
          <div class="input-group">
            <label for="serviceKey">Service key (for generation)</label>
            <input type="text" id="serviceKey" value="rm_playground_database" placeholder="e.g. rm_playground_database" title="serviceKey for generated actions" />
          </div>
        </div>
      </div>
      <div class="panel-header"><h2>Function JSON files</h2><div class="header-actions-wrap"><div class="actions-group"><span class="actions-group-label">Functions</span><div class="actions-bar"><button type="button" class="btn btn-primary" id="runValidate">Validate functions</button><label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);margin:0;"><input type="checkbox" id="validateFix" /> With --fix</label><button type="button" class="btn btn-secondary" id="refreshFunctions">Refresh</button><button type="button" class="btn btn-danger" id="deleteAllFunctions" title="Delete all JSON files in this directory"><span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete All</span></button></div></div><div class="actions-group"><span class="actions-group-label">Generate actions</span><div class="actions-bar"><button type="button" class="btn btn-secondary" id="selectAllFunctions">Select all</button><button type="button" class="btn btn-secondary" id="selectNoneFunctions">Select none</button><button type="button" class="btn btn-primary" id="runActions">Generate actions</button></div></div></div></div>
      <div class="panel-body"><ul class="accordion" id="functionsList"></ul></div>
    </div>

    <div id="panel-actions" class="panel">
      <div class="panel-config">
        <div class="panel-config-title">Source</div>
        <div class="inputs">
          <div class="input-group">
            <label for="actionsListDir">Actions dir</label>
            <input type="text" id="actionsListDir" value="actions/" placeholder="e.g. actions/repo-name" title="Directory of action JSON files to display" />
          </div>
        </div>
      </div>
      <div class="panel-config postman-test-panel">
        <div class="panel-config-title">Test endpoint</div>
        <div class="postman-base-url-row">
          <label for="testBaseUrl" class="postman-base-url-label">Execute base URL</label>
          <input type="text" id="testBaseUrl" class="postman-base-url-input" value="https://refreshing-amazement-production.up.railway.app/api/v2/execute" title="Base URL for execute API" placeholder="https://.../api/v2/execute" />
        </div>
        <div class="postman-url-row">
          <div class="postman-method-wrap">
            <label for="testMethod" class="sr-only">Method</label>
            <select id="testMethod"><option value="GET">GET</option><option value="POST" selected>POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH</option><option value="DELETE">DELETE</option></select>
          </div>
          <div class="postman-url-wrap">
            <label for="testUrl" class="sr-only">URL</label>
            <input type="text" id="testUrl" placeholder="https://.../api/v2/execute/serviceKey/actionName" />
          </div>
          <button type="button" class="btn btn-primary postman-send-btn" id="testSend">Send</button>
        </div>
        <div class="postman-action-row">
          <div class="input-group postman-action-select-wrap">
            <label for="testActionSelect">Action</label>
            <select id="testActionSelect"><option value="">Choose an action…</option></select>
          </div>
          <button type="button" class="btn btn-secondary" id="testLoadFromDir">Load endpoints</button>
          <button type="button" class="btn btn-secondary" id="testSuggestAi" title="Suggest params and body from action schema (requires API key)">Suggest with AI</button>
        </div>
        <div class="postman-request-tabs">
          <button type="button" class="postman-tab active" data-postman-tab="params">Params</button>
          <button type="button" class="postman-tab" data-postman-tab="body">Body</button>
        </div>
        <div class="postman-tab-panels">
          <div id="postmanPanelParams" class="postman-tab-panel active">
            <label for="testQueryParams" class="postman-label">Query params (JSON)</label>
            <textarea id="testQueryParams" class="postman-textarea" placeholder="{}" spellcheck="false"></textarea>
          </div>
          <div id="postmanPanelBody" class="postman-tab-panel">
            <label for="testBody" class="postman-label">Body (JSON)</label>
            <textarea id="testBody" class="postman-textarea" placeholder="" spellcheck="false"></textarea>
          </div>
        </div>
        <div class="postman-response">
          <div class="postman-response-header">
            <span class="postman-response-title">Response</span>
            <span id="testResponseStatus" class="postman-response-status"></span>
          </div>
          <pre class="log-box test-response postman-response-body" id="testResponse">—</pre>
        </div>
      </div>
      <div class="panel-header"><h2>Action JSON files</h2><div class="header-actions-wrap"><div class="actions-group"><span class="actions-group-label">Actions</span><div class="actions-bar"><button type="button" class="btn btn-secondary" id="refreshActions">Refresh</button><button type="button" class="btn btn-danger" id="deleteAllActions" title="Delete all JSON files in this directory"><span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Delete All</span></button></div></div><div class="actions-group"><span class="actions-group-label">Upload</span><div class="actions-bar"><button type="button" class="btn btn-secondary" id="selectAllActions">Select all</button><button type="button" class="btn btn-secondary" id="selectNoneActions">Select none</button><button type="button" class="btn btn-primary" id="runUpload">Upload selected</button></div></div><div class="actions-group"><span class="actions-group-label">Update serviceKey</span><div class="actions-bar"><input type="text" id="bulkServiceKey" placeholder="e.g. rm_playground_database" title="New serviceKey for selected action files" style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--stat-bg);color:var(--text);font-size:13px;min-width:180px;" /><button type="button" class="btn btn-primary" id="bulkUpdateServiceKey">Update selected</button></div></div><div class="actions-group"><span class="actions-group-label">Show</span><div class="actions-bar"><select id="actionsUploadFilter" title="Filter by status"><option value="all">All</option><option value="not-uploaded">Not uploaded</option><option value="uploaded">Uploaded</option><option value="not-working">Not working</option><option value="working">Working</option></select></div></div></div></div>
      <div class="panel-body">
        <ul class="accordion" id="actionsList"></ul>
      </div>
      <div class="panel-config remarks-card">
        <div class="panel-config-title">Remarks</div>
        <div id="remarksList" class="remarks-list"></div>
      </div>
      <div class="test-subtabs">
        <button type="button" class="test-subtab active" data-test-subtab="endpoints">Endpoints</button>
        <button type="button" class="test-subtab" data-test-subtab="tested">Tested</button>
      </div>
      <div class="panel-body panel-body-test">
        <div id="testSubtabEndpoints" class="test-subtab-panel">
          <div class="test-endpoints-wrap">
            <h3 class="test-endpoints-heading">Endpoints</h3>
            <ul class="test-endpoints-list" id="testEndpointsList"></ul>
          </div>
        </div>
        <div id="testSubtabTested" class="test-subtab-panel hidden">
          <p class="tested-intro">Actions you’ve confirmed as working (200 OK) appear here by service.</p>
          <div class="test-tested-bar">
            <button type="button" class="btn btn-secondary" id="refreshTested">Refresh</button>
          </div>
          <div id="testedList" class="tested-list">Loading...</div>
        </div>
      </div>
    </div>

    </div>

    <div class="command-output">
      <div class="command-output-header">
        <h3>Command output</h3>
        <button type="button" class="btn btn-danger hidden" id="runStop">Stop</button>
      </div>
      <div class="log-box" id="runLog">Output will appear here after running a command.</div>
    </div>

    <div id="testedConfirmModal" class="modal-overlay hidden" aria-hidden="true">
      <div class="modal-dialog">
        <p class="modal-message">The action returned 200 OK. Confirm that it&apos;s working and add it to tested history?</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" id="testedConfirmAdd">Add to tested</button>
          <button type="button" class="btn btn-secondary" id="testedConfirmCancel">Cancel</button>
        </div>
      </div>
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
    const apiRoutesDir = () => document.getElementById('apiRoutesDir').value.trim();
    const scanOutputPath = () => document.getElementById('scanOutputPath').value;
    const scanFunctionCodeDir = () => document.getElementById('scanFunctionCodeDir').value.trim() || 'functions/';
    const resultsDir = () => document.getElementById('resultsDir').value.trim() || 'results';
    const functionsDir = () => document.getElementById('functionsDir').value;
    const actionsDir = () => document.getElementById('actionsDir').value;
    const actionsListDir = () => document.getElementById('actionsListDir').value.trim() || 'actions/';
    const appName = () => document.getElementById('appName').value;
    const serviceKey = () => document.getElementById('serviceKey').value.trim();
    const testBaseUrl = () => document.getElementById('testBaseUrl').value.trim().replace(/\\/$/, '');
    const testedPath = () => 'actions/tested.json';

    const TEST_STORAGE_KEY = 'dashboard-test-endpoints';
    function getTestEndpoints() {
      try {
        const raw = localStorage.getItem(TEST_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    }
    function saveTestEndpoints(arr) {
      localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(arr));
    }

    let currentTestEndpoint = null;
    let pendingTestedAdd = null;
    let lastTestEndpoints = [];

    async function loadTestedList() {
      const container = document.getElementById('testedList');
      if (!container) return;
      try {
        const data = await api('/api/tested?path=' + encodeURIComponent(testedPath()));
        if (!data || typeof data !== 'object') {
          container.innerHTML = '<p style="color:var(--text-muted);padding:16px;">No tested actions recorded.</p>';
          return;
        }
        const keys = Object.keys(data).filter(k => Array.isArray(data[k]) && data[k].length > 0).sort();
        if (keys.length === 0) {
          container.innerHTML = '<p style="color:var(--text-muted);padding:16px;">No tested actions recorded.</p>';
          return;
        }
        let html = '';
        keys.forEach(serviceKey => {
          const actions = data[serviceKey];
          html += '<div class="tested-service-group"><h4>' + escapeHtml(serviceKey) + '</h4><ul>';
          actions.forEach(actionName => {
            html += '<li>' + escapeHtml(actionName) + '</li>';
          });
          html += '</ul></div>';
        });
        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = '<div class="log-box error">' + escapeHtml(e.message || String(e)) + '</div>';
      }
    }

    function renderTestEndpoints() {
      const list = document.getElementById('testEndpointsList');
      const selectEl = document.getElementById('testActionSelect');
      const endpoints = getTestEndpoints();
      lastTestEndpoints = endpoints;
      if (selectEl) {
        const uploadedOptions = endpoints.map((ep, i) => ep.uploaded ? '<option value="' + i + '">' + escapeHtml(ep.serviceKey) + ' / ' + escapeHtml(ep.actionName) + (ep.displayName ? ' — ' + escapeHtml(ep.displayName) : '') + '</option>' : '').filter(Boolean).join('');
        selectEl.innerHTML = '<option value="">Choose an action…</option>' + (uploadedOptions || '<option value="" disabled>No uploaded actions — mark actions as uploaded above</option>');
      }
      if (!endpoints.length) {
        list.innerHTML = '<li style="padding:16px;color:var(--text-muted);">No endpoints. Click "Load endpoints" above to populate.</li>';
        return;
      }
      list.innerHTML = endpoints.map((ep, i) => '<li data-index="' + i + '" data-service-key="' + escapeHtml(ep.serviceKey) + '" data-action-name="' + escapeHtml(ep.actionName) + '" data-file="' + escapeHtml(ep.file || '') + '" data-display-name="' + escapeHtml(ep.displayName || '') + '"><div class="test-endpoint-info"><strong>' + escapeHtml(ep.serviceKey) + ' / ' + escapeHtml(ep.actionName) + '</strong>' + (ep.displayName ? '<span>' + escapeHtml(ep.displayName) + '</span>' : '') + '</div><button type="button" class="btn btn-primary btn-test-endpoint">Test</button></li>').join('');
      list.querySelectorAll('.btn-test-endpoint').forEach(btn => {
        btn.addEventListener('click', async () => {
          const li = btn.closest('li');
          if (!li) return;
          const idx = parseInt(li.dataset.index, 10);
          if (selectEl) selectEl.value = String(idx);
          const ep = lastTestEndpoints[idx];
          if (!ep) return;
          currentTestEndpoint = { serviceKey: ep.serviceKey, actionName: ep.actionName, file: ep.file || null, displayName: ep.displayName || null };
          document.getElementById('testUrl').value = testBaseUrl() + '/' + ep.serviceKey + '/' + ep.actionName;
          document.getElementById('testQueryParams').value = '{}';
          document.getElementById('testBody').value = '';
          document.getElementById('testResponse').textContent = '—';
          document.getElementById('testResponseStatus').textContent = '';
          try {
            if (ep.file) {
              const actionJson = await api('/api/actions/file?dir=' + encodeURIComponent(actionsListDir()) + '&file=' + encodeURIComponent(ep.file));
              const method = (actionJson && actionJson.httpMethod) ? String(actionJson.httpMethod) : 'POST';
              document.getElementById('testMethod').value = method;
            }
          } catch (_) { document.getElementById('testMethod').value = 'POST'; }
        });
      });
    }

    document.querySelectorAll('.tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'params') loadParams();
      });
    });
    document.querySelectorAll('.test-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.test-subtab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const id = btn.dataset.testSubtab;
        document.getElementById('testSubtabEndpoints').classList.toggle('hidden', id !== 'endpoints');
        document.getElementById('testSubtabTested').classList.toggle('hidden', id !== 'tested');
        if (id === 'tested') loadTestedList();
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

    function paramsSource() { return document.getElementById('paramsSource').value; }
    function paramsScanPath() { const v = document.getElementById('paramsScanPath').value.trim(); return v || scanOutputPath(); }

    async function loadParams() {
      const container = document.getElementById('paramsList');
      const source = paramsSource();
      try {
        if (source === 'api') {
          const data = await api('/api/proxy/system-parameters');
          const params = data.data && data.data.parameters ? data.data.parameters : [];
          if (!params.length) {
            container.innerHTML = '<p style="color:var(--text-muted);padding:16px;">No system parameters returned from the API.</p>';
            return;
          }
          container.innerHTML = '<ul class="params-list-ul">' + params.map(p => {
            const name = escapeHtml((p.serviceKey || '') + ' / ' + (p.paramKey || p.name || ''));
            const desc = (p.displayName || p.description) ? '<div class="params-desc">' + escapeHtml([p.displayName, p.description].filter(Boolean).join(' — ')) + '</div>' : '';
            return '<li class="params-item"><div class="params-name">' + name + '</div>' + desc + '</li>';
          }).join('') + '</ul>';
        } else {
          const path = paramsScanPath();
          const data = await api('/api/scan-result?path=' + encodeURIComponent(path));
          const params = data.requiredSystemParams;
          if (!params || !Array.isArray(params) || params.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);padding:16px;">No system parameters in this scan result. Run a scan with API route handlers that use process.env to populate this list.</p>';
            return;
          }
          container.innerHTML = '<ul class="params-list-ul">' + params.map(p => {
            const name = escapeHtml(p.name || '');
            const desc = (p.description && p.description.trim()) ? '<div class="params-desc">' + escapeHtml(p.description.trim()) + '</div>' : '';
            return '<li class="params-item"><div class="params-name">' + name + '</div>' + desc + '</li>';
          }).join('') + '</ul>';
        }
      } catch (e) {
        container.innerHTML = '<div class="log-box error">' + escapeHtml(e.message || String(e)) + '</div>';
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
        list.innerHTML = data.files.map(f => '<li class="accordion-item"><div class="accordion-head" data-file="' + escapeHtml(f) + '"><input type="checkbox" class="function-generate-cb" data-file="' + escapeHtml(f) + '" title="Select for generate actions" /><span class="accordion-head-inner">' + escapeHtml(f) + '</span><button type="button" class="btn-icon btn-delete-file" title="Delete" aria-label="Delete">' + trashSvg + ' Delete</button></div><div class="accordion-body"><pre class="json-preview"></pre></div></li>').join('');
        list.querySelectorAll('.accordion-item').forEach(item => {
          const head = item.querySelector('.accordion-head');
          const inner = item.querySelector('.accordion-head-inner');
          const body = item.querySelector('.accordion-body .json-preview');
          const file = head.dataset.file;
          const deleteBtn = item.querySelector('.btn-delete-file');
          const cb = item.querySelector('.function-generate-cb');
          if (!file) return;
          if (cb) cb.addEventListener('click', (e) => e.stopPropagation());
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
      const dir = actionsListDir();
      const filterEl = document.getElementById('actionsUploadFilter');
      const filterValue = (filterEl && filterEl.value) || 'all';
      try {
        const data = await api('/api/actions/list?dir=' + encodeURIComponent(dir));
        if (!data.files.length) {
          list.innerHTML = '<li class="accordion-item"><div class="accordion-head">No JSON files</div></li>';
          if (filterEl && !filterEl._uploadFilterBound) {
            filterEl._uploadFilterBound = true;
            filterEl.addEventListener('change', loadActions);
          }
          return;
        }
        let remarks = {};
        try {
          const remarksData = await api('/api/actions/remarks?dir=' + encodeURIComponent(dir));
          remarks = remarksData.remarks || {};
        } catch (_) { /* ignore */ }
        const fileMeta = data.fileMeta || {};
        const filteredFiles = data.files.filter(function(f) {
          const meta = fileMeta[f];
          const uploaded = meta && meta.uploaded;
          const working = meta && meta.working;
          if (filterValue === 'uploaded') return uploaded;
          if (filterValue === 'not-uploaded') return !uploaded;
          if (filterValue === 'working') return working;
          if (filterValue === 'not-working') return !working;
          return true;
        });
        if (filterEl && !filterEl._uploadFilterBound) {
          filterEl._uploadFilterBound = true;
          filterEl.addEventListener('change', loadActions);
        }
        const trashSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        function rowHtml(f) {
          const meta = fileMeta[f] || {};
          const uploaded = !!meta.uploaded;
          const uploadedAt = meta.uploadedAt || '';
          const working = !!meta.working;
          const workingAt = meta.workingAt || '';
          const badge = uploaded ? '<span class="action-uploaded-badge" title="' + escapeHtml(uploadedAt) + '">Uploaded</span>' : '';
          const workingBadge = working ? '<span class="action-working-badge" title="' + escapeHtml(workingAt) + '">Working</span>' : '';
          const markBtnLabel = uploaded ? 'Unmark uploaded' : 'Mark uploaded';
          const markBtn = '<button type="button" class="btn btn-secondary action-mark-uploaded-btn" data-file="' + escapeHtml(f) + '" data-uploaded="' + (uploaded ? '1' : '0') + '" title="' + (uploaded ? 'Remove uploaded flag' : 'Mark as uploaded (tracking only)') + '">' + markBtnLabel + '</button>';
          const markWorkingBtnLabel = working ? 'Unmark working' : 'Mark working';
          const markWorkingBtn = '<button type="button" class="btn btn-secondary action-mark-working-btn" data-file="' + escapeHtml(f) + '" data-working="' + (working ? '1' : '0') + '" title="' + (working ? 'Remove working flag' : 'Mark as working (tested/verified)') + '">' + markWorkingBtnLabel + '</button>';
          return '<li class="accordion-item"><div class="accordion-head" data-file="' + escapeHtml(f) + '"><input type="checkbox" class="action-upload-cb" data-file="' + escapeHtml(f) + '" title="Select for upload" /><span class="accordion-head-inner">' + badge + workingBadge + escapeHtml(f) + '</span>' + markBtn + markWorkingBtn + '<button type="button" class="btn-icon btn-delete-file" title="Delete" aria-label="Delete">' + trashSvg + ' Delete</button></div><div class="accordion-body"><div class="action-remark-wrap"><label>Remark</label><textarea class="action-remark-input" data-file="' + escapeHtml(f) + '" placeholder="Add a note for this action…"></textarea><div class="action-remark-actions"><button type="button" class="btn btn-secondary btn-save-remark" data-file="' + escapeHtml(f) + '">Save remark</button><span class="action-remark-status"></span></div></div><pre class="json-preview"></pre></div></li>';
        }
        list.innerHTML = filteredFiles.length ? filteredFiles.map(rowHtml).join('') : '<li class="accordion-item"><div class="accordion-head">No actions match filter</div></li>';
        list.querySelectorAll('.accordion-item').forEach(item => {
          const head = item.querySelector('.accordion-head');
          const inner = item.querySelector('.accordion-head-inner');
          const body = item.querySelector('.accordion-body .json-preview');
          const file = head.dataset.file;
          const deleteBtn = item.querySelector('.btn-delete-file');
          const markUploadedBtn = item.querySelector('.action-mark-uploaded-btn');
          const markWorkingBtn = item.querySelector('.action-mark-working-btn');
          const cb = item.querySelector('.action-upload-cb');
          const saveRemarkBtn = item.querySelector('.btn-save-remark');
          const remarkInput = item.querySelector('.action-remark-input');
          const remarkStatus = item.querySelector('.action-remark-status');
          if (!file) return;
          if (markUploadedBtn) {
            markUploadedBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const currentlyUploaded = markUploadedBtn.getAttribute('data-uploaded') === '1';
              const newUploaded = !currentlyUploaded;
              try {
                const res = await fetch('/api/actions/uploaded', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, file, uploaded: newUploaded }) });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || res.statusText);
                loadActions();
              } catch (err) {
                alert('Failed to update: ' + (err.message || err));
              }
            });
          }
          if (markWorkingBtn) {
            markWorkingBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const currentlyWorking = markWorkingBtn.getAttribute('data-working') === '1';
              const newWorking = !currentlyWorking;
              try {
                const res = await fetch('/api/actions/working', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, file, working: newWorking }) });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || res.statusText);
                loadActions();
              } catch (err) {
                alert('Failed to update: ' + (err.message || err));
              }
            });
          }
          var r = remarks[file];
          remarkInput.value = (typeof r === 'string' ? r : (r && r.remark ? r.remark : '')) || '';
          if (cb) cb.addEventListener('click', (e) => e.stopPropagation());
          saveRemarkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const remark = remarkInput.value.trim();
            remarkStatus.textContent = '';
            try {
              const res = await fetch('/api/actions/remarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, file, remark }) });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || res.statusText);
              remarkStatus.textContent = 'Saved';
              remarkStatus.style.color = 'var(--success, #22c55e)';
              setTimeout(() => { remarkStatus.textContent = ''; }, 2000);
              renderRemarksDisplay(data.remarks || {});
            } catch (err) {
              remarkStatus.textContent = 'Failed';
              remarkStatus.style.color = '#ef4444';
            }
          });
          remarkInput.addEventListener('keydown', (e) => e.stopPropagation());
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
        renderRemarksDisplay(remarks);
      } catch (e) {
        list.innerHTML = '<li class="accordion-item expanded"><div class="accordion-head"><span class="accordion-head-inner">Error</span></div><div class="accordion-body"><pre class="json-preview">' + escapeHtml(e.message) + '</pre></div></li>';
        renderRemarksDisplay({});
      }
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function renderRemarksDisplay(remarks) {
      const container = document.getElementById('remarksList');
      if (!container) return;
      const dir = actionsListDir();
      const normalized = {};
      if (remarks && typeof remarks === 'object') {
        Object.keys(remarks).forEach(function (k) {
          const v = remarks[k];
          const text = typeof v === 'string' ? v : (v && v.remark ? v.remark : '');
          const resolved = typeof v === 'object' && v && v.resolved === true;
          if (text && String(text).trim()) normalized[k] = { remark: String(text).trim(), resolved: !!resolved };
        });
      }
      const keys = Object.keys(normalized).sort(function (a, b) {
        const ra = normalized[a].resolved;
        const rb = normalized[b].resolved;
        if (ra !== rb) return ra ? 1 : -1;
        return a.localeCompare(b);
      });
      if (keys.length === 0) {
        container.innerHTML = '<div class="remarks-list-empty">No remarks. Add notes in the accordion above and click Save remark.</div>';
        return;
      }
      container.innerHTML = keys.map(function (file) {
        const entry = normalized[file];
        const text = entry.remark;
        const resolved = entry.resolved;
        const resolvedCls = resolved ? ' remark-item resolved' : ' remark-item';
        return '<div class="' + resolvedCls + '" data-file="' + escapeHtml(file) + '"><div class="remark-item-file">' + escapeHtml(file) + '</div><div class="remark-item-text">' + escapeHtml(text) + '</div><div class="remark-item-resolved-wrap"><label><input type="checkbox" class="remark-resolved-cb" data-file="' + escapeHtml(file) + '" ' + (resolved ? 'checked' : '') + ' /> Resolved</label></div></div>';
      }).join('');
      container.querySelectorAll('.remark-resolved-cb').forEach(function (cb) {
        cb.addEventListener('change', function () {
          const file = cb.getAttribute('data-file');
          const resolved = cb.checked;
          fetch('/api/actions/remarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, file, resolved }) }).then(function (res) { return res.json(); }).then(function (data) {
            if (data && data.remarks) renderRemarksDisplay(data.remarks);
          }).catch(function () {});
        });
      });
    }

    function setRunLog(text, isError) {
      const el = document.getElementById('runLog');
      el.textContent = text || '';
      el.className = 'log-box' + (isError ? ' error' : ' success');
      el.scrollTop = el.scrollHeight;
    }

    const runButtons = ['runScan', 'runValidate', 'runActions', 'runUpload'];
    const stopBtns = [document.getElementById('runStop')];

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
          if (body.command === 'scan') { loadScan(); loadResults(); loadParams(); loadFunctions(); loadActions(); }
          if (body.command === 'validate-functions' || body.command === 'actions') loadFunctions();
          if (body.command === 'actions' || body.command === 'upload-actions') loadActions();
          if (body.command === 'upload-actions' && body.uploadFiles?.length) {
            try {
              const data = await api('/api/actions/endpoints?dir=' + encodeURIComponent(actionsListDir()));
              const selectedSet = new Set(body.uploadFiles);
              const uploaded = (data.endpoints || []).filter(ep => selectedSet.has(ep.file));
              const existing = getTestEndpoints();
              const byKey = {};
              existing.forEach(ep => { byKey[ep.serviceKey + '::' + ep.actionName] = ep; });
              uploaded.forEach(ep => { byKey[ep.serviceKey + '::' + ep.actionName] = { serviceKey: ep.serviceKey, actionName: ep.actionName, displayName: ep.displayName, file: ep.file, uploaded: ep.uploaded }; });
              saveTestEndpoints(Object.values(byKey));
              renderTestEndpoints();
            } catch (err) { /* ignore */ }
          }
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

    document.getElementById('refreshScan').addEventListener('click', loadScan);
    document.getElementById('generatePrismaSql').addEventListener('click', async () => {
      const btn = document.getElementById('generatePrismaSql');
      const outputEl = document.getElementById('prismaSqlOutput');
      const preEl = document.getElementById('prismaSqlPre');
      const errEl = document.getElementById('prismaSqlError');
      const copyBtn = document.getElementById('copyPrismaSql');
      errEl.classList.add('hidden');
      errEl.textContent = '';
      outputEl.classList.add('hidden');
      copyBtn.classList.add('hidden');
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Generating…';
      try {
        const res = await fetch('/api/prisma-to-sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoPath: scanDir() }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          errEl.textContent = data.error || res.statusText || 'Request failed';
          errEl.classList.remove('hidden');
          return;
        }
        preEl.textContent = data.sql || '';
        outputEl.classList.remove('hidden');
        copyBtn.classList.remove('hidden');
      } catch (e) {
        errEl.textContent = (e.message || e) + '';
        errEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
    document.getElementById('copyPrismaSql').addEventListener('click', () => {
      const pre = document.getElementById('prismaSqlPre');
      const t = pre && pre.textContent;
      if (!t) return;
      navigator.clipboard.writeText(t).then(() => {
        const copyBtn = document.getElementById('copyPrismaSql');
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = prev; }, 2000);
      }).catch(() => {});
    });
    document.getElementById('refreshResults').addEventListener('click', loadResults);
    document.getElementById('refreshParams').addEventListener('click', loadParams);
    document.getElementById('paramsSource').addEventListener('change', () => {
      const group = document.getElementById('paramsScanPathGroup');
      group.style.display = paramsSource() === 'scan' ? '' : 'none';
    });
    (function initParamsSourceVisibility() {
      document.getElementById('paramsScanPathGroup').style.display = paramsSource() === 'scan' ? '' : 'none';
    })();
    (function () {
      const sel = document.getElementById('paramServiceKey');
      const customInput = document.getElementById('paramServiceKeyCustom');
      function toggleCustom() {
        customInput.style.display = sel.value === '__custom__' ? 'block' : 'none';
        if (sel.value !== '__custom__') customInput.value = '';
      }
      sel.addEventListener('change', toggleCustom);
      toggleCustom();
    })();
    (function () {
      const sel = document.getElementById('paramTenant');
      const customInput = document.getElementById('paramTenantCustom');
      function toggleCustom() {
        customInput.style.display = sel.value === '__custom__' ? 'block' : 'none';
        if (sel.value !== '__custom__') customInput.value = '';
      }
      sel.addEventListener('change', toggleCustom);
      toggleCustom();
    })();
    document.getElementById('paramSubmit').addEventListener('click', async () => {
      const msgEl = document.getElementById('paramFormMessage');
      msgEl.textContent = '';
      msgEl.className = 'params-form-message';
      const serviceKeySelect = document.getElementById('paramServiceKey');
      const serviceKeyCustom = document.getElementById('paramServiceKeyCustom');
      const serviceKey = (serviceKeySelect.value === '__custom__' ? serviceKeyCustom.value : serviceKeySelect.value).trim();
      const paramKey = document.getElementById('paramParamKey').value.trim();
      if (!serviceKey) { msgEl.textContent = 'serviceKey is required.'; msgEl.classList.add('error'); return; }
      if (!paramKey) { msgEl.textContent = 'paramKey is required.'; msgEl.classList.add('error'); return; }
      const tenantSelect = document.getElementById('paramTenant');
      const tenantCustom = document.getElementById('paramTenantCustom');
      const tenantRaw = tenantSelect.value === '__custom__' ? tenantCustom.value.trim() : tenantSelect.value;
      const tenant = tenantRaw === '' || tenantRaw === 'null' ? null : tenantRaw;
      const payload = {
        serviceKey,
        paramKey,
        paramValue: document.getElementById('paramParamValue').value.trim() || undefined,
        displayName: document.getElementById('paramDisplayName').value.trim() || undefined,
        description: document.getElementById('paramDescription').value.trim() || undefined,
        category: document.getElementById('paramCategory').value.trim() || undefined,
        tenant,
        isRequired: document.getElementById('paramIsRequired').checked,
        isEncrypted: document.getElementById('paramIsEncrypted').checked
      };
      try {
        const res = await fetch('/api/proxy/system-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          msgEl.textContent = data.message || data.error || res.statusText || 'Request failed';
          msgEl.classList.add('error');
          return;
        }
        msgEl.textContent = 'Added successfully.';
        msgEl.classList.add('success');
        setTimeout(() => { msgEl.textContent = ''; msgEl.classList.remove('success'); }, 3000);
        document.getElementById('paramServiceKey').value = 'rm_database';
        document.getElementById('paramServiceKeyCustom').value = '';
        document.getElementById('paramServiceKeyCustom').style.display = 'none';
        document.getElementById('paramParamKey').value = '';
        document.getElementById('paramParamValue').value = '';
        document.getElementById('paramDisplayName').value = '';
        document.getElementById('paramDescription').value = '';
        document.getElementById('paramCategory').value = '';
        document.getElementById('paramTenant').value = '1';
        document.getElementById('paramTenantCustom').value = '';
        document.getElementById('paramTenantCustom').style.display = 'none';
        document.getElementById('paramIsRequired').checked = false;
        document.getElementById('paramIsEncrypted').checked = false;
      } catch (e) {
        msgEl.textContent = (e.message || e) + '';
        msgEl.classList.add('error');
      }
    });
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
      if (!confirm('Delete all action JSON files in ' + actionsListDir() + '? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/actions/all?dir=' + encodeURIComponent(actionsListDir()), { method: 'DELETE' });
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
      functionCodeDir: scanFunctionCodeDir(),
      apiRoutesDir: apiRoutesDir() || undefined,
      generateActions: document.getElementById('scanGenerateActions').checked,
      actionsOutputDir: document.getElementById('scanActionsOutputDir').value.trim() || undefined
    }));
    document.getElementById('runValidate').addEventListener('click', () => runCommand({
      command: 'validate-functions',
      functionsDir: functionsDir(),
      fix: document.getElementById('validateFix').checked
    }));
    document.getElementById('selectAllFunctions').addEventListener('click', () => {
      document.querySelectorAll('#functionsList .function-generate-cb').forEach(cb => { cb.checked = true; });
    });
    document.getElementById('selectNoneFunctions').addEventListener('click', () => {
      document.querySelectorAll('#functionsList .function-generate-cb').forEach(cb => { cb.checked = false; });
    });
    document.getElementById('runActions').addEventListener('click', () => {
      const selected = Array.from(document.querySelectorAll('#functionsList .function-generate-cb:checked')).map(el => el.getAttribute('data-file')).filter(Boolean);
      runCommand({
        command: 'actions',
        actionsInputDir: functionsDir(),
        actionsOutputDir: actionsDir(),
        appName: appName(),
        serviceKey: serviceKey() || undefined,
        actionFunctionFiles: selected.length ? selected : undefined
      });
    });
    document.getElementById('runUpload').addEventListener('click', () => {
      const selected = Array.from(document.querySelectorAll('#actionsList .action-upload-cb:checked')).map(el => el.getAttribute('data-file')).filter(Boolean);
      if (!selected.length) {
        alert('Select at least one action to upload.');
        return;
      }
      runCommand({
        command: 'upload-actions',
        actionsOutputDir: actionsListDir(),
        uploadFiles: selected
      });
    });
    document.getElementById('selectAllActions').addEventListener('click', () => {
      document.querySelectorAll('#actionsList .action-upload-cb').forEach(cb => { cb.checked = true; });
    });
    document.getElementById('selectNoneActions').addEventListener('click', () => {
      document.querySelectorAll('#actionsList .action-upload-cb').forEach(cb => { cb.checked = false; });
    });
    document.getElementById('bulkUpdateServiceKey').addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('#actionsList .action-upload-cb:checked')).map(el => el.getAttribute('data-file')).filter(Boolean);
      if (!selected.length) {
        alert('Select at least one action file.');
        return;
      }
      const serviceKey = document.getElementById('bulkServiceKey').value.trim();
      if (!serviceKey) {
        alert('Enter a serviceKey.');
        return;
      }
      try {
        const res = await fetch('/api/actions/bulk-update-service-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: actionsListDir(), files: selected, serviceKey })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Update failed');
          return;
        }
        loadActions();
        if (data.failed && data.failed.length) {
          alert('Updated ' + data.updated + ' file(s). Failed: ' + data.failed.join(', '));
        } else {
          alert('Updated ' + data.updated + ' file(s).');
        }
      } catch (e) {
        alert('Update failed: ' + (e.message || e));
      }
    });

    document.querySelectorAll('.postman-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const id = tab.dataset.postmanTab;
        document.querySelectorAll('.postman-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.postman-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = id === 'params' ? document.getElementById('postmanPanelParams') : document.getElementById('postmanPanelBody');
        if (panel) panel.classList.add('active');
      });
    });

    document.getElementById('testActionSelect').addEventListener('change', async () => {
      const selectEl = document.getElementById('testActionSelect');
      const val = selectEl.value;
      if (val === '') {
        currentTestEndpoint = null;
        document.getElementById('testUrl').value = '';
        return;
      }
      const idx = parseInt(val, 10);
      const ep = lastTestEndpoints[idx];
      if (!ep) return;
      currentTestEndpoint = { serviceKey: ep.serviceKey, actionName: ep.actionName, file: ep.file || null, displayName: ep.displayName || null };
      document.getElementById('testUrl').value = testBaseUrl() + '/' + ep.serviceKey + '/' + ep.actionName;
      document.getElementById('testQueryParams').value = '{}';
      document.getElementById('testBody').value = '';
      document.getElementById('testResponse').textContent = '—';
      document.getElementById('testResponseStatus').textContent = '';
      try {
        if (ep.file) {
          const actionJson = await api('/api/actions/file?dir=' + encodeURIComponent(actionsListDir()) + '&file=' + encodeURIComponent(ep.file));
          document.getElementById('testMethod').value = (actionJson && actionJson.httpMethod) ? String(actionJson.httpMethod) : 'POST';
        }
      } catch (_) { document.getElementById('testMethod').value = 'POST'; }
    });

    document.getElementById('testLoadFromDir').addEventListener('click', async () => {
      try {
        const data = await api('/api/actions/endpoints?dir=' + encodeURIComponent(actionsListDir()));
        const endpoints = (data.endpoints || []).map(ep => ({ serviceKey: ep.serviceKey, actionName: ep.actionName, displayName: ep.displayName, file: ep.file, uploaded: ep.uploaded }));
        saveTestEndpoints(endpoints);
        renderTestEndpoints();
      } catch (e) {
        alert('Load failed: ' + (e.message || e));
      }
    });

    function setButtonLoading(btn, loading) {
      if (loading) {
        btn.dataset.originalText = btn.textContent;
        btn.disabled = true;
        btn.classList.add('btn-loading');
        btn.innerHTML = '<span class="btn-spinner"></span> ' + (btn.dataset.originalText || 'Loading...');
      } else {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        btn.textContent = btn.dataset.originalText || '';
      }
    }
    document.getElementById('testSuggestAi').addEventListener('click', async () => {
      if (!currentTestEndpoint || !currentTestEndpoint.file) {
        alert('Choose an action from the dropdown (or click "Load endpoints" first).');
        return;
      }
      const btn = document.getElementById('testSuggestAi');
      setButtonLoading(btn, true);
      try {
        const actionJson = await api('/api/actions/file?dir=' + encodeURIComponent(actionsListDir()) + '&file=' + encodeURIComponent(currentTestEndpoint.file));
        const res = await fetch('/api/test/suggest-payload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionJson }) });
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        const payload = result.payload || {};
        const hasPayload = typeof payload === 'object' && payload !== null && Object.keys(payload).length > 0;
        document.getElementById('testBody').value = hasPayload ? JSON.stringify(payload, null, 2) : '';
        document.getElementById('testQueryParams').value = JSON.stringify(result.queryParams || {}, null, 2);
      } catch (e) {
        document.getElementById('testResponse').textContent = 'Suggest failed: ' + (e.message || e);
        document.getElementById('testResponse').className = 'log-box test-response postman-response-body error';
        document.getElementById('testResponseStatus').textContent = '';
      } finally {
        setButtonLoading(btn, false);
      }
    });

    document.getElementById('testSend').addEventListener('click', async () => {
      const url = document.getElementById('testUrl').value.trim();
      const method = document.getElementById('testMethod').value.trim() || 'POST';
      let body = document.getElementById('testBody').value.trim();
      let queryParams = {};
      try {
        const qRaw = document.getElementById('testQueryParams').value.trim();
        if (qRaw) queryParams = JSON.parse(qRaw);
      } catch (e) {
        document.getElementById('testResponseStatus').textContent = 'Error';
        document.getElementById('testResponseStatus').className = 'postman-response-status error';
        document.getElementById('testResponse').textContent = 'Invalid query params JSON: ' + e.message;
        document.getElementById('testResponse').className = 'log-box test-response postman-response-body error';
        return;
      }
      const sendBtn = document.getElementById('testSend');
      const statusEl = document.getElementById('testResponseStatus');
      setButtonLoading(sendBtn, true);
      statusEl.textContent = '';
      try {
        const res = await fetch('/api/test/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, method, body: body || undefined, queryParams }) });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        statusEl.textContent = data.status + ' ' + (data.statusText || '');
        statusEl.className = 'postman-response-status' + (data.ok ? ' success' : ' error');
        const out = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2);
        document.getElementById('testResponse').textContent = out;
        document.getElementById('testResponse').className = 'log-box test-response postman-response-body' + (data.ok ? ' success' : ' error');
        if (data.status === 200 && currentTestEndpoint?.serviceKey && currentTestEndpoint?.actionName) {
          pendingTestedAdd = { serviceKey: currentTestEndpoint.serviceKey, actionName: currentTestEndpoint.actionName, file: currentTestEndpoint.file || null };
          const modal = document.getElementById('testedConfirmModal');
          if (modal) { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); }
        }
      } catch (e) {
        statusEl.textContent = 'Error';
        statusEl.className = 'postman-response-status error';
        document.getElementById('testResponse').textContent = 'Request failed: ' + (e.message || e);
        document.getElementById('testResponse').className = 'log-box test-response postman-response-body error';
      } finally {
        setButtonLoading(sendBtn, false);
      }
    });
    document.getElementById('refreshTested').addEventListener('click', loadTestedList);

    function closeTestedConfirmModal() {
      pendingTestedAdd = null;
      const modal = document.getElementById('testedConfirmModal');
      if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); }
    }
    document.getElementById('testedConfirmAdd').addEventListener('click', async () => {
      if (!pendingTestedAdd) { closeTestedConfirmModal(); return; }
      try {
        await fetch('/api/tested', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: testedPath(), serviceKey: pendingTestedAdd.serviceKey, actionName: pendingTestedAdd.actionName }) });
        if (pendingTestedAdd.file) {
          await fetch('/api/actions/working', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: actionsListDir(), file: pendingTestedAdd.file, working: true }) });
          loadActions();
        }
        const testedPanel = document.getElementById('testSubtabTested');
        if (testedPanel && !testedPanel.classList.contains('hidden')) loadTestedList();
      } catch (_) { /* ignore */ }
      closeTestedConfirmModal();
    });
    document.getElementById('testedConfirmCancel').addEventListener('click', closeTestedConfirmModal);
    document.getElementById('testedConfirmModal').addEventListener('click', (e) => {
      if (e.target.id === 'testedConfirmModal') closeTestedConfirmModal();
    });

    loadScan();
    loadResults();
    loadParams();
    loadFunctions();
    loadActions();
    renderTestEndpoints();
  </script>
</body>
</html>`;
