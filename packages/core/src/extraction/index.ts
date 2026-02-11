/**
 * Extraction module - function code extraction phase (runs after detection).
 */

export {
  FunctionExtractor,
  extractFunctionCodeForApiCalls,
  DEFAULT_MAX_FUNCTION_LINES,
  type FunctionExtractionResult,
} from "./function-extractor";
export {
  discoverAllRouteHandlers,
  discoveredHandlersToApiCalls,
  findAllRouteFiles,
  routeFileToApiPath,
  type DiscoveredRouteHandler,
} from "./route-discoverer";
