/**
 * Dashboard command - start the dashboard UI server.
 */

import * as path from "path";
import { startDashboardServer } from "../viewer/dashboard-server";

export interface DashboardOptions {
  port?: number;
  /** Working directory (default: cwd) */
  cwd?: string;
  openBrowser?: boolean;
}

export async function handleDashboard(
  options: DashboardOptions,
): Promise<void> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  await startDashboardServer({
    port: options.port,
    cwd,
    openBrowser: options.openBrowser,
  });
}
