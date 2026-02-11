/**
 * Mark action JSON files as uploaded or not uploaded (for tracking).
 * Updates the `uploaded` and `uploadedAt` fields in each file on disk.
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface MarkUploadedOptions {
  /** Directory containing action JSON files */
  inputDir: string;
  /** If true, set uploaded to false and remove uploadedAt; otherwise set uploaded true and uploadedAt */
  unmark: boolean;
  /** If set, only update these filenames (must be .json in inputDir). Omit to update all .json in directory. */
  files?: string[];
}

export async function handleMarkUploaded(
  options: MarkUploadedOptions
): Promise<void> {
  const inputDir = path.resolve(options.inputDir);

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

  const action = options.unmark ? "Unmark" : "Mark";
  console.log(
    `${action}ing ${jsonFiles.length} action(s) as ${options.unmark ? "not uploaded" : "uploaded"}...`
  );

  let ok = 0;
  let err = 0;

  for (const name of jsonFiles) {
    const filePath = path.join(inputDir, name);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (options.unmark) {
        obj.uploaded = false;
        delete obj.uploadedAt;
      } else {
        obj.uploaded = true;
        obj.uploadedAt = new Date().toISOString();
      }
      await fs.writeFile(
        filePath,
        JSON.stringify(obj, null, 2),
        "utf-8"
      );
      ok++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
      err++;
    }
  }

  console.log(`\nDone. ${ok} updated, ${err} failed.`);
  if (err > 0) {
    process.exit(1);
  }
}

export interface MarkWorkingOptions {
  /** Directory containing action JSON files */
  inputDir: string;
  /** If true, set working to false and remove workingAt; otherwise set working true and workingAt */
  unmark: boolean;
  /** If set, only update these filenames (must be .json in inputDir). Omit to update all .json in directory. */
  files?: string[];
}

export async function handleMarkWorking(
  options: MarkWorkingOptions
): Promise<void> {
  const inputDir = path.resolve(options.inputDir);

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

  const action = options.unmark ? "Unmark" : "Mark";
  console.log(
    `${action}ing ${jsonFiles.length} action(s) as ${options.unmark ? "not working" : "working"}...`
  );

  let ok = 0;
  let err = 0;

  for (const name of jsonFiles) {
    const filePath = path.join(inputDir, name);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (options.unmark) {
        obj.working = false;
        delete obj.workingAt;
      } else {
        obj.working = true;
        obj.workingAt = new Date().toISOString();
      }
      await fs.writeFile(
        filePath,
        JSON.stringify(obj, null, 2),
        "utf-8"
      );
      ok++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
      err++;
    }
  }

  console.log(`\nDone. ${ok} updated, ${err} failed.`);
  if (err > 0) {
    process.exit(1);
  }
}

export interface ActionsStatusOptions {
  /** Directory containing action JSON files */
  inputDir: string;
}

/** List all action JSON files with their uploaded status (for tracking what still needs upload/test). */
export async function handleActionsStatus(
  options: ActionsStatusOptions
): Promise<void> {
  const inputDir = path.resolve(options.inputDir);

  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(inputDir, { withFileTypes: true });
  } catch (e) {
    console.error(`Error: Cannot read directory ${inputDir}:`, e);
    process.exit(1);
  }

  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();

  if (files.length === 0) {
    console.log(`No action JSON files in ${inputDir}`);
    return;
  }

  const rows: Array<{
    file: string;
    uploaded: boolean;
    uploadedAt?: string;
    working: boolean;
    workingAt?: string;
  }> = [];
  for (const name of files) {
    try {
      const raw = await fs.readFile(path.join(inputDir, name), "utf-8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (typeof obj.actionName !== "string") continue;
      const uploaded = obj.uploaded === true;
      const uploadedAt =
        typeof obj.uploadedAt === "string" ? obj.uploadedAt : undefined;
      const working = obj.working === true;
      const workingAt =
        typeof obj.workingAt === "string" ? obj.workingAt : undefined;
      rows.push({ file: name, uploaded, uploadedAt, working, workingAt });
    } catch {
      rows.push({ file: name, uploaded: false, working: false });
    }
  }

  const maxFile = Math.max(...rows.map((r) => r.file.length), 10);
  const header =
    "FILE".padEnd(maxFile) + "  UPLOADED   WORKING   UPLOADED_AT / WORKING_AT";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    const upStatus = r.uploaded ? "yes" : "no ";
    const workStatus = r.working ? "yes" : "no ";
    const date = r.workingAt
      ? new Date(r.workingAt).toISOString().slice(0, 19).replace("T", " ")
      : r.uploadedAt
        ? new Date(r.uploadedAt).toISOString().slice(0, 19).replace("T", " ")
        : "";
    console.log(
      r.file.padEnd(maxFile) + "  " + upStatus + "        " + workStatus + "      " + date
    );
  }

  const uploadedCount = rows.filter((r) => r.uploaded).length;
  const workingCount = rows.filter((r) => r.working).length;
  const notUploaded = rows.length - uploadedCount;
  const notWorking = rows.length - workingCount;
  console.log("");
  console.log(
    `Total: ${rows.length}  Uploaded: ${uploadedCount} (${notUploaded} not)  Working: ${workingCount} (${notWorking} not)`
  );
}
