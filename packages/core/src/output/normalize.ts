/**
 * Result normalization - deduplicate and group API calls
 */

import { ApiCall, NormalizedEndpoint, CallSite } from '@api-surface/types';

export interface NormalizedResult {
  endpoints: NormalizedEndpoint[];
  totalCalls: number;
  uniqueEndpoints: number;
  byMethod: Record<string, number>;
  bySource: Record<string, number>;
  byConfidence: Record<string, number>;
}

/**
 * Normalize API calls by grouping identical endpoints
 */
export function normalizeResults(apiCalls: ApiCall[]): NormalizedResult {
  // Create a map keyed by method + URL
  const endpointMap = new Map<string, NormalizedEndpoint>();

  for (const call of apiCalls) {
    const key = createEndpointKey(call.method, call.url);
    
    if (!endpointMap.has(key)) {
      // Create new normalized endpoint
      endpointMap.set(key, {
        method: call.method,
        url: call.url,
        source: call.source,
        callSites: [],
        confidence: call.confidence || 'low',
        callCount: 0,
      });
    }

    const endpoint = endpointMap.get(key)!;
    
    // Add call site
    const callSite: CallSite = {
      file: call.file,
      line: call.line,
      column: call.column,
      confidence: call.confidence,
    };
    endpoint.callSites.push(callSite);
    endpoint.callCount++;

    // Update confidence to highest level
    if (call.confidence) {
      endpoint.confidence = getHighestConfidence(endpoint.confidence, call.confidence);
    }
  }

  // Convert to array and sort
  const endpoints = Array.from(endpointMap.values()).sort((a, b) => {
    // Sort by method, then URL
    if (a.method !== b.method) {
      return a.method.localeCompare(b.method);
    }
    return a.url.localeCompare(b.url);
  });

  // Calculate statistics
  const byMethod: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};

  for (const endpoint of endpoints) {
    byMethod[endpoint.method] = (byMethod[endpoint.method] || 0) + 1;
    bySource[endpoint.source] = (bySource[endpoint.source] || 0) + 1;
    byConfidence[endpoint.confidence] = (byConfidence[endpoint.confidence] || 0) + 1;
  }

  return {
    endpoints,
    totalCalls: apiCalls.length,
    uniqueEndpoints: endpoints.length,
    byMethod,
    bySource,
    byConfidence,
  };
}

/**
 * Create a unique key for an endpoint (method + URL)
 */
function createEndpointKey(method: string, url: string): string {
  return `${method.toUpperCase()}:${url}`;
}

/**
 * Get the highest confidence level
 */
function getHighestConfidence(
  current: 'high' | 'medium' | 'low',
  newConfidence: 'high' | 'medium' | 'low'
): 'high' | 'medium' | 'low' {
  const levels = { low: 0, medium: 1, high: 2 };
  return levels[newConfidence] > levels[current] ? newConfidence : current;
}
