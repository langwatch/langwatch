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
export {
  BrowserUiDocumentTitle,
  resolveUiCapabilities,
  UiCapabilityContextProvider,
  UiCapabilityUnavailableError,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiNavigationPort,
  UiSessionPort,
  useUiCapabilities,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  type UiCapabilityInstall,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "./behavior/ui-capabilities";
export {
  mergeUiPageLoaders,
  uiFeatureLoaders,
  type UiPageLoaderMerge,
} from "./behavior/ui-feature-loaders";
export {
  createUiFeatureApiClient,
  UI_TRPC_ENDPOINT,
  uiFeatureApi,
  type UiFeatureApiBinding,
  type UiFeatureApiClientOptions,
  type UiFeatureApiProvider,
  type UiFeatureApiTransport,
} from "./behavior/ui-feature-transport";
export { createRouterUiNavigation, useRouterUiNavigation } from "./behavior/ui-router-navigation";
export {
  resolveUiPageLoader,
  uiRoutePageKeys,
  type UiPageLoader,
  type UiPageLoaderRegistry,
} from "./behavior/ui-page-loaders";
export { createUiRouter, type UiRouter, type UiRouterOptions } from "./behavior/ui-router";
export {
  uiLegacyRedirectRoutes,
  uiRouteDescriptors,
  uiRouteTable,
  type UiPageRouteDescriptor,
  type UiRedirectDescriptor,
  type UiRedirectRouteDescriptor,
  type UiRouteDescriptor,
} from "./model/ui-route-table";
export {
  createUiApplication,
  type UiApplication,
  type UiApplicationInstall,
  type UiFeatureInstall,
} from "./ui/sections/ui-application";
export { createUiFeatureShell, type UiFeatureShellInstall } from "./ui/sections/ui-feature-shell";
export {
  createUiInnerProvider,
  type UiInnerProviderInstall,
} from "./ui/sections/ui-inner-providers";
export {
  createUiOuterProvider,
  type UiOuterProviderInstall,
  type UiProviderShell,
} from "./ui/sections/ui-outer-providers";
export { createUiRouteObjects, type UiRouteObjectsOptions } from "./ui/sections/ui-route-objects";
export { createUiRootLayout, type UiRootLayoutInstall } from "./ui/sections/ui-root-layout";
export { RpcClientPort } from "./features/agent/behavior/rpc-client.port";
export { TrpcAgentBrowserAdapter } from "./features/agent/behavior/trpc-agent-browser.adapter";
export {
  createPublicAppConfigMetaTag,
  injectPublicAppConfigIntoHtml,
  PUBLIC_APP_CONFIG_META_NAME,
  publicAppConfigSchema,
  readPublicAppConfig,
  type PublicAppConfig,
  type PublicEnvironment,
  toPublicEnvironment,
} from "./behavior/public-config";
// The deployment projection, kept off the browser reader's graph on purpose —
// it declares the names of the deployment's secret variables at module scope.
// Server code should prefer `@langwatch/ui/public-config/projection`, which
// reaches it without pulling the root barrel.
export {
  LOCAL_GATEWAY_URL,
  resolveGatewayBaseUrl,
  resolveUiPublicBootstrap,
  SAAS_GATEWAY_URL,
  type GatewayBaseUrlSource,
  type UiPublicBootstrap,
} from "./behavior/public-config.projection";
