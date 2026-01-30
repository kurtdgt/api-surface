# api-surface

CLI tool to scan JavaScript/TypeScript repositories and detect frontend API calls.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Use the CLI

After building, you can use the CLI from the project root:

```bash
# Scan a directory
node packages/cli/dist/cli.js scan ./your-project

# Or link it globally (after building)
cd packages/cli && npm link
api-surface scan ./your-project
```

## Commands

| Command                               | Description                                               |
| ------------------------------------- | --------------------------------------------------------- |
| `scan <directory>`                    | Scan a directory for API calls (fetch, axios, custom).    |
| `diff <baseline> <current>`           | Compare two scan result JSON files.                       |
| `open [scan-file]`                    | Open scan results in a web viewer.                        |
| `actions <input-dir> -o <output-dir>` | Generate action JSON from API function JSON using OpenAI. |

### Command templates

```bash
# Scan – detect API calls, optional function code output and config
api-surface scan <directory> [options]
  --root <path>              Root directory (defaults to <directory>)
  -c, --config <path>        Path to api-surface config file
  --framework <type>         none | nextjs | react-native | react | generic (default: none)
  -o, --output <path>        Write normalized scan result JSON to file
  --function-code-dir <path> Write one JSON per endpoint (API function code) into this directory

# Diff – compare two scan results
api-surface diff <baseline> <current> [options]
  -o, --output <path>        Write diff result to file

# Open – view scan results in browser
api-surface open [scan-file] [options]
  -p, --port <number>        Web server port (default: 3000)

# Actions – generate action JSON from API function JSON (OpenAI)
api-surface actions <input-dir> -o <output-dir> [options]
  -o, --output-dir <path>    (required) Directory where action JSON files are written
  --service-key <key>        Default serviceKey for generated actions
  --env <path>               Path to .env file (for OPENAI_API_KEY; default: .env in cwd)
  -c, --config <path>        Path to action.config.json (defaultDatabaseUrl, defaultServiceKey)
```

## Structure

This is a monorepo with the following packages:

- **`@api-surface/types`** - Shared TypeScript types and interfaces
- **`@api-surface/core`** - Framework-agnostic core scanner logic
- **`api-surface`** (CLI) - Command-line interface entry point
- **`@api-surface/nextjs`** - Optional Next.js-specific adapter

## Usage

### Zero-config (no config required)

The scanner **always** runs both fetch and axios detectors. No config file is needed.

- **Fetch** – `fetch()`, `fetch(url, { method: 'POST' })`, etc.
- **Axios** – `axios.get()`, `axios.post()`, named imports from `'axios'`, and common wrappers like `api.get()` when `api` is from `@/config/axios`, `lib/axios`, `utils/axios`, etc.

Just run:

```bash
npx api-surface scan ./path-to-repo
```

Config is optional. Use it only for custom include/exclude, framework hints, or extra API client patterns.

### Scan Command

Scan a directory for API calls:

```bash
npx api-surface scan <directory>
```

Options:

- `--root <path>` - Root directory (defaults to `<directory>`)
- `-c, --config <path>` - Path to config file
- `--framework <type>` - Framework type: `none`, `nextjs`, `react-native`, `react`, `generic` (default: `none`)
- `-o, --output <path>` - Output file path (default: stdout)
- `--function-code-dir <path>` - Write one JSON file per endpoint (API function code) into this directory; when `apiRoutesDir` is set in config, only endpoints resolved from that directory (e.g. `src/app/api`) are written

Examples:

```bash
# Scan current directory
npx api-surface scan .

# Scan with Next.js framework
npx api-surface scan ./src --framework nextjs

# Scan React Native repo (zero-config: fetch + axios, excludes android/ios/.expo)
npx api-surface scan . --framework react-native

# Scan and save to file
npx api-surface scan ./src --output scan-result.json

# Scan with custom config
npx api-surface scan ./src --config .api-surface.json
```

### Diff Command

Compare two scan results:

```bash
npx api-surface diff <baseline> <current>
```

Options:

- `-o, --output <path>` - Output file path (default: stdout)

Example:

```bash
npx api-surface diff baseline.json current.json --output diff.json
```

### Open Command

View scan results in a web browser:

```bash
api-surface open [scan-file]
```

Options:

- `-p, --port <number>` - Port for web server (default: 3000)
- `[scan-file]` - Optional path to scan result JSON file (auto-finds latest if not specified)

Examples:

```bash
# Open latest scan result in browser
api-surface open

# Open specific scan file
api-surface open scan-result.json

# Use custom port
api-surface open --port 8080
```

The web viewer shows:

- Summary statistics
- Endpoint list with HTTP methods
- Call sites (file locations)
- Confidence indicators
- Grouped endpoints

## React Native

React Native repos work with **zero config**. The scanner:

- Detects **fetch** and **axios** (including wrappers like `api.get()` from `@/config/axios`).
- Excludes **android/**, **ios/**, **.expo/**, \***\*mocks**/\*\* and config files by default.

```bash
# From the React Native project root
npx api-surface scan . --framework react-native -o api-surface.json
```

Optional `api-surface.config.json` in the project root:

```json
{
  "include": ["src/**/*.{js,jsx,ts,tsx}", "app/**/*.{js,jsx,ts,tsx}"],
  "exclude": [
    "**/node_modules/**",
    "**/android/**",
    "**/ios/**",
    "**/.expo/**"
  ],
  "framework": "react-native"
}
```

## Complete Workflow Example

```bash
# 1. Scan your project
api-surface scan ./src --output results.json

# 2. View results in terminal (summary is shown automatically)
# The JSON file is also saved for later use

# 3. Open web viewer
api-surface open results.json

# 4. Compare with previous scan
api-surface diff baseline.json results.json --output diff.json
```

### Actions workflow (API function → action JSON)

Requires `OPENAI_API_KEY` in `.env`. Uses `action.config.json` for `defaultDatabaseUrl` and `defaultServiceKey` (optional).

```bash
# 1. Scan with API function output (only endpoints from src/app/api when apiRoutesDir is set)
api-surface scan ./your-project -o results.json --function-code-dir functions/resto-inspect

# 2. Generate action JSON from those function files
api-surface actions functions/resto-inspect -o ./actions

# With custom config and service key
api-surface actions functions/resto-inspect -o ./actions -c action.config.json --service-key rm_playground_database
```

## Configuration

Configuration is **optional**. Fetch and axios are **always** scanned; config never turns them off.

Use a config file only when you need custom include/exclude, framework hints, or extra API client patterns. Create an `api-surface.config.ts` (or `.json`) in your project root:

```typescript
export default {
  include: ["**/*.{js,jsx,ts,tsx}"],
  exclude: ["**/node_modules/**", "**/dist/**"],
  framework: "nextjs", // or 'react', 'generic', 'none'
  apiClients: [
    { type: "fetch" },
    { type: "axios" },
    { type: "custom", name: "myApi", patterns: ["@/lib/api"] },
  ],
};
```

Or use JSON format (`api-surface.config.json`):

```json
{
  "include": ["**/*.{js,jsx,ts,tsx}"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "framework": "nextjs",
  "apiClients": [{ "type": "fetch" }, { "type": "axios" }]
}
```

## What Gets Detected

With or without config, the tool automatically detects:

- **fetch()** calls: `fetch('/api/users')`, `fetch(url, { method: 'POST' })`
- **axios** calls: `axios.get()`, `axios.post()`, `axios.request()`
- Named imports: `import { get, post } from 'axios'` → `get()`, `post()`
- **Axios wrappers** (no config needed): `api.get()`, `api.post()` when `api` is imported from common paths like `@/config/axios`, `lib/axios`, `utils/axios`, etc.

Each detection includes:

- HTTP method (GET, POST, etc.)
- URL (with confidence: high/medium/low)
- Source file and line number
- Call site information
