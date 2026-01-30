# api-surface — Command reference

CLI to scan JavaScript/TypeScript repos for frontend API calls and generate action JSON from API route handlers.

**Usage:** `api-surface <command> [options]`

---

## Commands overview

| Command                                   | Description                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [scan](#scan)                             | Scan a directory for API calls (fetch, axios). Optionally emit function-code JSON per endpoint. |
| [diff](#diff)                             | Compare two scan result JSON files.                                                             |
| [open](#open)                             | Serve scan results in a web viewer.                                                             |
| [validate-functions](#validate-functions) | Validate API function JSON files (method, url). Optional `--fix` to normalize formatting.       |
| [actions](#actions)                       | Generate action JSON from API function JSON using Claude or OpenAI (executeAction format).      |
| [upload-actions](#upload-actions)         | Upload action JSON files from a directory to the Railway action-generator API.                  |
| [dashboard](#dashboard)                   | Start the dashboard UI (scan results, functions, actions, run commands via buttons).            |

---

## scan

Scan a directory for API calls and optionally write one JSON file per endpoint with function code.

```bash
api-surface scan <directory> [options]
```

| Argument / option            | Description                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `<directory>`                | Directory to scan (required).                                                   |
| `--root <path>`              | Root directory (default: `<directory>`).                                        |
| `-c, --config <path>`        | Path to config file (e.g. `api-surface.config.ts`).                             |
| `--framework <type>`         | `none` \| `nextjs` \| `react-native` \| `react` \| `generic` (default: `none`). |
| `-o, --output <path>`        | Write normalized scan result JSON to this file.                                 |
| `--function-code-dir <path>` | Write one JSON per endpoint (method, url, functionCode) into this directory.    |

**Examples**

```bash
api-surface scan .
api-surface scan ./src --framework nextjs -o results.json
api-surface scan ./src -o results.json --function-code-dir functions/resto-inspect
```

---

## diff

Compare two scan result JSON files (baseline vs current).

```bash
api-surface diff <baseline> <current> [options]
```

| Argument / option     | Description                                       |
| --------------------- | ------------------------------------------------- |
| `<baseline>`          | Path to baseline scan result JSON.                |
| `<current>`           | Path to current scan result JSON.                 |
| `-o, --output <path>` | Write diff result to this file (default: stdout). |

**Example**

```bash
api-surface diff baseline.json current.json -o diff.json
```

---

## open

Start a local web server to view scan results.

```bash
api-surface open [scan-file] [options]
```

| Argument / option     | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `[scan-file]`         | Path to scan result JSON (optional; uses latest if omitted). |
| `-p, --port <number>` | Port for web server (default: 3000).                         |

**Examples**

```bash
api-surface open
api-surface open results.json --port 8080
```

---

## validate-functions

Validate API function JSON files: must be valid JSON with `method` and `url` (string). Optionally rewrite files with consistent formatting.

```bash
api-surface validate-functions <input-dir> [options]
```

| Argument / option | Description                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| `<input-dir>`     | Directory containing API function JSON files (e.g. `functions/resto-inspect`). |
| `--fix`           | Rewrite valid files with 2-space JSON formatting.                              |

**Examples**

```bash
api-surface validate-functions functions/resto-inspect
api-surface validate-functions functions/resto-inspect --fix
```

---

## actions

Generate action JSON files from API function JSON. Converts Next.js route handlers into `executeAction(payload, context)` format. Uses **Claude** if `ANTHROPIC_API_KEY` is set, otherwise **OpenAI** if `OPENAI_API_KEY` is set.

```bash
api-surface actions <input-dir> -o <output-dir> [options]
```

| Argument / option         | Description                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `<input-dir>`             | Directory with API function JSON files (e.g. from `scan --function-code-dir`).                    |
| `-o, --output-dir <path>` | Directory where action JSON files will be written (required).                                     |
| `--name <app-name>`       | App name to concatenate with action name (e.g. `resto-inspect` → `get-resto-inspect-properties`). |
| `--service-key <key>`     | Default `serviceKey` for generated actions (e.g. `rm_playground_database`).                       |
| `--env <path>`            | Path to `.env` file (default: `.env` in cwd).                                                     |
| `-c, --config <path>`     | Path to `action.config.json` (default: `action.config.json` in cwd).                              |

**Environment**

- **Claude:** `ANTHROPIC_API_KEY` in `.env` or environment.
- **OpenAI:** `OPENAI_API_KEY` in `.env` or environment (used only if `ANTHROPIC_API_KEY` is not set).

**Config (`action.config.json`)**

- `defaultServiceKey` / `serviceKey` — default service key for actions.
- `defaultDatabaseUrl` — default system parameter name for DB URL (e.g. `PLAYGROUND_DATABASE_URL`).

**Examples**

```bash
api-surface actions functions/resto-inspect -o actions/resto-inspect --name resto-inspect
api-surface actions functions/resto-inspect -o actions/resto-inspect --name resto-inspect --service-key rm_playground_database -c action.config.json
```

---

## upload-actions

Upload action JSON files from a directory to the Railway action-generator API. Each file is sent as `POST` with `Content-Type: application/json` to the create-simple endpoint.

```bash
api-surface upload-actions <input-dir> [options]
```

| Argument / option | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `<input-dir>`     | Directory containing action JSON files (e.g. `actions/resto-inspect`).      |
| `--url <url>`     | API URL (default: Railway production URL, or `RAILWAY_ACTION_URL` env var). |

**Default URL:** `https://refreshing-amazement-production.up.railway.app/api/action-generator/create-simple`

**Examples**

```bash
api-surface upload-actions actions/resto-inspect
RAILWAY_ACTION_URL=https://your-app.up.railway.app/api/action-generator/create-simple api-surface upload-actions actions/resto-inspect
api-surface upload-actions actions/resto-inspect --url https://staging.up.railway.app/api/action-generator/create-simple
```

---

## dashboard

Start the dashboard UI in your browser. View scan results, function JSON files, and action JSON files; run **Scan**, **Validate functions**, **Generate actions**, and **Upload actions** with buttons (paths are configurable in the UI).

```bash
api-surface dashboard [options]
```

| Option           | Description                                    |
| ---------------- | ---------------------------------------------- |
| `-p, --port <n>` | Port for the dashboard server (default: 3000). |
| `--no-open`      | Do not open the browser automatically.         |

**Examples**

```bash
api-surface dashboard
api-surface dashboard -p 4000
api-surface dashboard --no-open
```

---

## Typical workflow

1. **Scan** and emit function-code JSON per endpoint:

   ```bash
   api-surface scan ./your-app -o results.json --function-code-dir functions/resto-inspect
   ```

2. **Validate** (optional):

   ```bash
   api-surface validate-functions functions/resto-inspect --fix
   ```

3. **Generate actions** (Claude or OpenAI):

   ```bash
   api-surface actions functions/resto-inspect -o actions/resto-inspect --name resto-inspect
   ```

4. **Upload actions** to Railway (optional):

   ```bash
   api-surface upload-actions actions/resto-inspect
   ```

5. **View scan results** (optional):

   ```bash
   api-surface open results.json
   ```

6. **Compare scans** (optional):
   ```bash
   api-surface diff baseline.json results.json -o diff.json
   ```

**Or use the dashboard** to view everything and run commands from the browser:

```bash
api-surface dashboard
```

Then use the **Scan Results**, **Functions**, and **Actions** tabs to view data, and the **Run Commands** tab to run Scan, Validate, Generate actions, and Upload with one click (paths are editable in the header).
