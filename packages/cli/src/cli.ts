#!/usr/bin/env node

/**
 * CLI entry point
 */

import { Command } from "commander";
import { handleScan, ScanOptions } from "./commands/scan";
import { handleDiff, DiffOptions } from "./commands/diff";
import { handleOpen, OpenOptions } from "./commands/open";

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
    "none",
  )
  .option("-o, --output <path>", "Output file path")
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

// Open command
program
  .command("open")
  .description("View scan results in web viewer")
  .argument(
    "[scan-file]",
    "Path to scan result JSON file (optional, uses latest if not specified)",
  )
  .option(
    "-p, --port <number>",
    "Port for web server",
    (val) => parseInt(val, 10),
    3000,
  )
  .action(async (scanFile: string | undefined, options: OpenOptions) => {
    await handleOpen(scanFile || "", options);
  });

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
