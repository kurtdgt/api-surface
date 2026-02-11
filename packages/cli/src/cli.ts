#!/usr/bin/env node

/**
 * CLI entry point
 */

import { Command } from "commander";
import { handleActions } from "./commands/actions";
import { handleDashboard } from "./commands/dashboard";
import { DiffOptions, handleDiff } from "./commands/diff";
import { handleOpen, OpenOptions } from "./commands/open";
import { handleScan, ScanOptions } from "./commands/scan";
import {
  handleActionsStatus,
  handleMarkUploaded,
  handleMarkWorking,
} from "./commands/mark-uploaded";
import { handleUploadActions } from "./commands/upload-actions";
import { handleValidateFunctions } from "./commands/validate-functions";

const program = new Command();

program
  .name("api-surface")
  .description("Scan JavaScript/TypeScript repositories for frontend API calls")
  .version("0.1.0");

// Scan command
program
  .command("scan")
  .description("Scan a directory for API calls")
  .argument("<directory>", "Directory to scan")
  .option("--root <path>", "Root directory (defaults to <directory>)")
  .option("-c, --config <path>", "Path to config file")
  .option(
    "--framework <type>",
    "Framework type: none, nextjs, react-native, react, generic",
    "none"
  )
  .option("-o, --output <path>", "Output file path")
  .option(
    "--function-code-dir <path>",
    "Write one JSON file per endpoint with function code(s) into this directory"
  )
  .option(
    "--api-routes-dir <path>",
    "Directory to scan for API route handlers, relative to scanned root (e.g. src/app/api). Overrides config."
  )
  .option(
    "--generate-actions",
    "After writing function code, generate action JSON from each endpoint (inner routes included). Requires ANTHROPIC_API_KEY or OPENAI_API_KEY."
  )
  .option(
    "--actions-output-dir <path>",
    "Directory for action JSON when using --generate-actions (default: actions)"
  )
  .action(async (directory: string, options: ScanOptions) => {
    await handleScan(directory, options);
  });

// Diff command
program
  .command("diff")
  .description("Compare two scan results")
  .argument("<baseline>", "Path to baseline scan result JSON file")
  .argument("<current>", "Path to current scan result JSON file")
  .option("-o, --output <path>", "Output file path")
  .action(async (baseline: string, current: string, options: DiffOptions) => {
    await handleDiff(baseline, current, options);
  });

// Dashboard - full UI for scan results, functions, actions, and run commands
program
  .command("dashboard")
  .description(
    "Start the dashboard UI to view scan results, functions, actions, and run commands via buttons"
  )
  .option(
    "-p, --port <number>",
    "Port for the dashboard server",
    (v) => parseInt(v, 10),
    3000
  )
  .option("--no-open", "Do not open the browser automatically")
  .action(async (options: { port: number; open?: boolean }) => {
    await handleDashboard({
      port: options.port,
      openBrowser: options.open !== false,
    });
  });

// Open command
program
  .command("open")
  .description("View scan results in web viewer")
  .argument(
    "[scan-file]",
    "Path to scan result JSON file (optional, uses latest if not specified)"
  )
  .option(
    "-p, --port <number>",
    "Port for web server",
    (val) => parseInt(val, 10),
    3000
  )
  .action(async (scanFile: string | undefined, options: OpenOptions) => {
    await handleOpen(scanFile || "", options);
  });

// Validate function JSON files
program
  .command("validate-functions")
  .description(
    "Validate API function JSON files (method, url). Use --fix to normalize formatting."
  )
  .argument(
    "<input-dir>",
    "Directory containing API function JSON files (e.g. functions/resto-inspect)"
  )
  .option(
    "--fix",
    "Rewrite valid files with consistent JSON formatting (2-space indent)"
  )
  .action(async (inputDir: string, options: { fix?: boolean }) => {
    await handleValidateFunctions({
      inputDir,
      fix: options.fix,
    });
  });

// Upload actions to Railway
program
  .command("upload-actions")
  .description(
    "Upload action JSON files from a directory to the Railway action-generator API (create-simple)"
  )
  .argument(
    "<input-dir>",
    "Directory containing action JSON files (e.g. actions/resto-inspect)"
  )
  .option(
    "--url <url>",
    "API URL (default: Railway production or RAILWAY_ACTION_URL env)"
  )
  .option(
    "--files <list>",
    "Comma-separated filenames to upload (default: all .json in directory)"
  )
  .option(
    "--service-key <key>",
    "Override serviceKey in each action JSON before uploading"
  )
  .option(
    "--no-mark",
    "Do not mark actions as uploaded in the JSON files after successful upload"
  )
  .action(
    async (
      inputDir: string,
      options: { url?: string; files?: string; serviceKey?: string; mark?: boolean }
    ) => {
      const files = options.files
        ? options.files
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      await handleUploadActions({
        inputDir,
        url: options.url,
        files: files?.length ? files : undefined,
        serviceKeyOverride: options.serviceKey,
        markUploaded: options.mark !== false,
      });
    }
  );

// Actions command - generate action JSON from API function JSON using Claude or OpenAI
program
  .command("actions")
  .description(
    "Generate action JSON files from API function JSON (from scan --function-code-dir) using Claude (ANTHROPIC_API_KEY) or OpenAI (OPENAI_API_KEY)"
  )
  .argument(
    "<input-dir>",
    "Directory containing API function JSON files (e.g. functions/resto-inspect)"
  )
  .requiredOption(
    "-o, --output-dir <path>",
    "Directory where action JSON files will be written"
  )
  .option(
    "--service-key <key>",
    "Default serviceKey for generated actions (e.g. rm_playground_database)"
  )
  .option("--env <path>", "Path to .env file (default: .env in cwd)")
  .option(
    "-c, --config <path>",
    "Path to action.config.json (default: action.config.json in cwd). Use it to set defaultDatabaseUrl and defaultServiceKey."
  )
  .option(
    "--name <app-name>",
    "App name to concatenate with action name (e.g. resto-inspect → get-resto-inspect-properties)"
  )
  .option(
    "--functions <list>",
    "Comma-separated list of function JSON filenames to generate actions for (default: all in input dir)"
  )
  .action(
    async (
      inputDir: string,
      options: {
        outputDir: string;
        serviceKey?: string;
        env?: string;
        config?: string;
        name?: string;
        functions?: string;
      }
    ) => {
      const functionFiles = options.functions
        ? options.functions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      await handleActions({
        inputDir,
        outputDir: options.outputDir,
        serviceKey: options.serviceKey,
        appName: options.name,
        envPath: options.env,
        configPath: options.config,
        functionFiles,
      });
    }
  );

// Mark actions as uploaded (tracking only)
program
  .command("mark-uploaded")
  .description(
    "Mark action JSON files as uploaded or not (for tracking). Updates uploaded/uploadedAt in each file."
  )
  .argument(
    "<input-dir>",
    "Directory containing action JSON files (e.g. actions/storm-track)"
  )
  .option(
    "--unmark",
    "Remove uploaded flag (mark as not uploaded)"
  )
  .option(
    "--files <list>",
    "Comma-separated filenames to update (default: all .json in directory)"
  )
  .action(
    async (
      inputDir: string,
      options: { unmark?: boolean; files?: string }
    ) => {
      const files = options.files
        ? options.files
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      await handleMarkUploaded({
        inputDir,
        unmark: Boolean(options.unmark),
        files: files?.length ? files : undefined,
      });
    }
  );

// Mark actions as working (tested/verified)
program
  .command("mark-working")
  .description(
    "Mark action JSON files as working or not (tested/verified). Updates working/workingAt in each file."
  )
  .argument(
    "<input-dir>",
    "Directory containing action JSON files (e.g. actions/storm-track)"
  )
  .option("--unmark", "Remove working flag (mark as not working)")
  .option(
    "--files <list>",
    "Comma-separated filenames to update (default: all .json in directory)"
  )
  .action(
    async (
      inputDir: string,
      options: { unmark?: boolean; files?: string }
    ) => {
      const files = options.files
        ? options.files
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      await handleMarkWorking({
        inputDir,
        unmark: Boolean(options.unmark),
        files: files?.length ? files : undefined,
      });
    }
  );

// Show uploaded and working status of actions
program
  .command("actions-status")
  .description(
    "List action JSON files with uploaded and working status (see what still needs upload/test)"
  )
  .argument(
    "<input-dir>",
    "Directory containing action JSON files (e.g. actions/storm-track)"
  )
  .action(async (inputDir: string) => {
    await handleActionsStatus({ inputDir });
  });

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
