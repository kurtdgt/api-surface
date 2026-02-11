/**
 * Upload action JSON files from a directory to the Railway action-generator API.
 * POSTs each file to the create-simple endpoint with Content-Type: application/json.
 */

import * as fs from "fs/promises";
import * as path from "path";

const DEFAULT_RAILWAY_URL =
  "https://refreshing-amazement-production.up.railway.app/api/action-generator/create-simple";

export interface UploadActionsOptions {
  /** Directory containing action JSON files to upload */
  inputDir: string;
  /** API URL (default: Railway production URL, or RAILWAY_ACTION_URL env) */
  url?: string;
  /** If set, only upload these filenames (must be .json in inputDir) */
  files?: string[];
  /** If set, override serviceKey in each action JSON before uploading */
  serviceKeyOverride?: string;
  /** If true (default), mark each successfully uploaded action with uploaded: true and uploadedAt in the JSON file */
  markUploaded?: boolean;
}

export async function handleUploadActions(
  options: UploadActionsOptions
): Promise<void> {
  const inputDir = path.resolve(options.inputDir);
  const baseUrl =
    options.url ?? process.env.RAILWAY_ACTION_URL ?? DEFAULT_RAILWAY_URL;

  let jsonFiles: string[];
  if (options.files?.length) {
    jsonFiles = options.files
      .filter((f) => f.endsWith(".json") && !f.includes(".."))
      .sort();
    if (jsonFiles.length === 0) {
      console.error("Error: No valid .json filenames provided");
      process.exit(1);
    }
  } else {
    let entries: Array<{ name: string; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(inputDir, { withFileTypes: true });
    } catch (e) {
      console.error(`Error: Cannot read directory ${inputDir}:`, e);
      process.exit(1);
    }
    jsonFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort();
  }

  if (jsonFiles.length === 0) {
    console.log(`No JSON files found in ${inputDir}`);
    return;
  }

  const serviceKeyOverride = options.serviceKeyOverride?.trim();
  if (serviceKeyOverride) {
    console.log(
      `Overriding serviceKey to "${serviceKeyOverride}" for this batch.`
    );
  }
  console.log(`Uploading ${jsonFiles.length} action(s) to ${baseUrl}...`);

  let ok = 0;
  let err = 0;

  for (const name of jsonFiles) {
    const filePath = path.join(inputDir, name);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (e) {
      console.error(`  ✗ ${name}: failed to read file`);
      err++;
      continue;
    }

    let body = raw;
    if (serviceKeyOverride) {
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        obj.serviceKey = serviceKeyOverride;
        body = JSON.stringify(obj);
      } catch (e) {
        console.error(`  ✗ ${name}: invalid JSON, skipping`);
        err++;
        continue;
      }
    }

    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `  ✗ ${name}: ${response.status} ${response.statusText}${
            text ? ` — ${text.slice(0, 120)}` : ""
          }`
        );
        err++;
        continue;
      }

      ok++;
      console.log(`  ✓ ${name}`);

      if (options.markUploaded !== false) {
        try {
          const currentRaw = await fs.readFile(filePath, "utf-8");
          const obj = JSON.parse(currentRaw) as Record<string, unknown>;
          obj.uploaded = true;
          obj.uploadedAt = new Date().toISOString();
          await fs.writeFile(
            filePath,
            JSON.stringify(obj, null, 2),
            "utf-8"
          );
        } catch (e) {
          console.warn(`  ⚠ ${name}: could not update uploaded flag in file`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ ${name}: ${msg}`);
      err++;
    }
  }

  console.log(`\nDone. ${ok} uploaded, ${err} failed.`);
  if (err > 0) {
    process.exit(1);
  }
}
