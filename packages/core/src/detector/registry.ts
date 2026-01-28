/**
 * Detector Registry - manages and coordinates detectors
 */

import { Detector } from "./detector";
import { ScanConfig } from "@api-surface/types";

/**
 * Detector registry - manages all registered detectors
 */
export class DetectorRegistry {
  private detectors: Map<string, Detector> = new Map();
  private enabledDetectors: Set<string> = new Set();

  /**
   * Register a detector
   */
  register(detector: Detector): void {
    if (this.detectors.has(detector.id)) {
      console.warn(
        `Detector with id "${detector.id}" is already registered. Overwriting.`,
      );
    }

    this.detectors.set(detector.id, detector);
    this.enabledDetectors.add(detector.id);
  }

  /**
   * Unregister a detector
   */
  unregister(detectorId: string): boolean {
    const removed = this.detectors.delete(detectorId);
    this.enabledDetectors.delete(detectorId);
    return removed;
  }

  /**
   * Get a detector by ID
   */
  get(detectorId: string): Detector | undefined {
    return this.detectors.get(detectorId);
  }

  /**
   * Get all registered detectors
   */
  getAll(): Detector[] {
    return Array.from(this.detectors.values());
  }

  /**
   * Get all enabled detectors
   */
  getEnabled(): Detector[] {
    return Array.from(this.enabledDetectors)
      .map((id) => this.detectors.get(id))
      .filter((detector): detector is Detector => detector !== undefined);
  }

  /**
   * Enable a detector
   */
  enable(detectorId: string): boolean {
    if (!this.detectors.has(detectorId)) {
      return false;
    }
    this.enabledDetectors.add(detectorId);
    return true;
  }

  /**
   * Disable a detector
   */
  disable(detectorId: string): boolean {
    return this.enabledDetectors.delete(detectorId);
  }

  /**
   * Check if a detector is enabled
   */
  isEnabled(detectorId: string): boolean {
    return this.enabledDetectors.has(detectorId);
  }

  /**
   * Clear all detectors
   */
  clear(): void {
    this.detectors.clear();
    this.enabledDetectors.clear();
  }

  /**
   * Get detector count
   */
  getCount(): number {
    return this.detectors.size;
  }

  /**
   * Filter detectors based on config
   * This allows config to enable/disable specific detectors
   */
  filterByConfig(config: ScanConfig): Detector[] {
    const enabled = this.getEnabled();

    // If config specifies API clients, filter detectors that match
    const apiClients = config.apiClients;
    if (apiClients && Array.isArray(apiClients) && apiClients.length > 0) {
      const allowedSources = new Set(apiClients.map((client) => client.type));

      return enabled.filter((detector) => {
        // Match detector ID to config type (e.g., 'axios' detector for 'axios' type)
        // Built-in detectors: 'fetch' and 'axios' match their types
        return allowedSources.has(detector.id as "fetch" | "axios" | "custom");
      });
    }

    // If no apiClients specified, return all enabled detectors (backward compatibility)
    return enabled;
  }
}
