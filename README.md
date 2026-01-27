# api-surface

CLI tool to scan JavaScript/TypeScript repositories and detect frontend API calls.

## Structure

This is a monorepo with the following packages:

- **`@api-surface/types`** - Shared TypeScript types and interfaces
- **`@api-surface/core`** - Framework-agnostic core scanner logic
- **`api-surface`** (CLI) - Command-line interface entry point
- **`@api-surface/nextjs`** - Optional Next.js-specific adapter

## Installation

```bash
npm install
```

## Development

```bash
npm run build
```

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

View or explore a scan result:

```bash
npx api-surface open <scan-file>
```

Options:
- `--format <type>` - Output format: `json`, `table`, or `summary` (default: `json`)
- `--filter <pattern>` - Filter results by pattern

Example:
```bash
npx api-surface open scan-result.json --format summary
```
