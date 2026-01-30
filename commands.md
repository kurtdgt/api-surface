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
   api-surface actions functions/resto-inspect -o actions/resto-inspect
   ```

4. **View scan results** (optional):

   ```bash
   api-surface open results.json
   ```

5. **Compare scans** (optional):
   ```bash
   api-surface diff baseline.json results.json -o diff.json
   ```
