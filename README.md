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

## Structure

This is a monorepo with the following packages:

- **`@api-surface/types`** - Shared TypeScript types and interfaces
- **`@api-surface/core`** - Framework-agnostic core scanner logic
- **`api-surface`** (CLI) - Command-line interface entry point
- **`@api-surface/nextjs`** - Optional Next.js-specific adapter

## Usage

### Scan Command

Scan a directory for API calls:

```bash
npx api-surface scan <directory>
```

Options:
- `--root <path>` - Root directory (defaults to `<directory>`)
- `-c, --config <path>` - Path to config file
- `--framework <type>` - Framework type: `none` or `nextjs` (default: `none`)
- `-o, --output <path>` - Output file path (default: stdout)

Examples:
```bash
# Scan current directory
npx api-surface scan .

# Scan with Next.js framework detection
npx api-surface scan ./src --framework nextjs

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

## Configuration

Create an `api-surface.config.ts` file in your project root:

```typescript
export default {
  include: ['**/*.{js,jsx,ts,tsx}'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  framework: 'nextjs', // or 'react', 'generic', 'none'
  apiClients: [
    { type: 'fetch' },
    { type: 'axios' },
    { type: 'custom', name: 'myApi', patterns: ['@/lib/api'] }
  ]
};
```

Or use JSON format (`api-surface.config.json`):

```json
{
  "include": ["**/*.{js,jsx,ts,tsx}"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "framework": "nextjs",
  "apiClients": [
    { "type": "fetch" },
    { "type": "axios" }
  ]
}
```

## What Gets Detected

The tool automatically detects:

- **fetch()** calls: `fetch('/api/users')`, `fetch(url, { method: 'POST' })`
- **axios** calls: `axios.get()`, `axios.post()`, `axios.request()`
- Named imports: `import { get, post } from 'axios'` → `get()`, `post()`

Each detection includes:
- HTTP method (GET, POST, etc.)
- URL (with confidence: high/medium/low)
- Source file and line number
- Call site information
