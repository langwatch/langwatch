/**
 * What this package is, now that the api process boots on its module list.
 *
 * Everything a family used to export from here is exported by that family's
 * own module. What is left is the process itself: the root that states what
 * the api role is, its parsed config, the doors it opens and the lifecycle it
 * runs.
 */
export {
  apiProcessConfig,
  bootApiProcess,
  type ApiProcessMemberOverrides,
} from "./app/api-production.composition.ts";
export {
  ApiHttpListener,
  ApiRawRequestSurface,
  ApiUpgradeSurface,
  type ApiHttpListenerOptions,
  type ApiListenerAddress,
} from "./api-http.listener.ts";
export { ApiRuntime, type ApiRuntimeOptions } from "./api.runtime.ts";
export {
  ApiApplicationPort,
  ApiLifecycle,
  type ApiShutdownOptions,
} from "./api-runtime.port.ts";
export {
  ApiMetrics,
  ApiProcessLifecycleRoutes,
  ApiReadiness,
} from "./api-process.lifecycle.ts";
export { resolveApiConfig, type ApiConfig } from "./platform/config/api.config.ts";
