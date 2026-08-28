export { UiShellPort } from "./behavior/ui-runtime.port";
export { UiRuntime, type UiRuntimeOptions } from "./behavior/ui.runtime";
export {
  UiApplicationShell,
  type UiApplicationShellProps,
  type UiOuterProvider,
} from "./ui/sections/ui-application-shell";
export {
  UiDesignSystemShell,
  type UiDesignSystemShellProps,
} from "./ui/sections/ui-design-system-shell";
export { UiPrefixRedirect } from "./ui/elements/ui-prefix-redirect";
export {
  forceReloadOnce,
  isChunkLoadError,
  registerChunkReloadListener,
  reloadOnChunkError,
  RELOAD_AT_KEY,
  warmChunk,
} from "./behavior/chunk-reload";
export { lazyRoute, type LazyRouteModule } from "./behavior/lazy-route";
export { RpcClientPort } from "./features/agent/behavior/rpc-client.port";
export { TrpcAgentBrowserAdapter } from "./features/agent/behavior/trpc-agent-browser.adapter";
export {
  createPublicAppConfigMetaTag,
  injectPublicAppConfigIntoHtml,
  PUBLIC_APP_CONFIG_META_NAME,
  publicAppConfigSchema,
  readPublicAppConfig,
  resolveGatewayBaseUrl,
  resolveUiPublicBootstrap,
  SAAS_GATEWAY_URL,
  LOCAL_GATEWAY_URL,
  type PublicAppConfig,
  type PublicEnvironment,
  type GatewayBaseUrlSource,
  type UiPublicBootstrap,
  toPublicEnvironment,
} from "./behavior/public-config";
