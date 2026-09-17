/**
 * What this package is, now that the api process boots on its module list:
 * everything a family used to export here is exported by that family's own
 * module. What's left is the process root — role, config, doors, lifecycle.
 */
export {
  apiProcessConfig,
  bootApiProcess,
  type ApiProcessMemberOverrides,
} from "./app/api-production.composition.ts";
export {
  ApiHttpListener,
  ApiPreRoutingSurface,
  ApiUpgradeSurface,
  type ApiHttpListenerOptions,
  type ApiListenerAddress,
} from "./api-http.listener.ts";
export {
  startStandaloneApi,
  type ApiExecutableHost,
  type StartStandaloneApiOptions,
} from "./api.entrypoint.main.ts";
export {
  ApiMetrics,
  ApiProcessLifecycleRoutes,
  ApiReadiness,
} from "./api-process.lifecycle.ts";
export { resolveApiConfig, type ApiConfig } from "./platform/config/api.config.ts";
