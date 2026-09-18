export { UiShell } from "./behavior/ui-shell";
export { UiRuntime, type UiRuntimeOptions } from "./behavior/ui.runtime";
export {
  UiApplicationShell,
  type UiApplicationShellProps,
  type UiOuterProvider,
} from "./shell/ui-application-shell";
export { UiDesignSystemShell, type UiDesignSystemShellProps } from "./shell/ui-design-system-shell";
export { UiPrefixRedirect } from "./shell/ui-prefix-redirect";
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
  UiDocumentTitle,
  UiFeedback,
  UiNavigation,
  UiSession,
  useUiCapabilities,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  type UiCapabilityInstall,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "@langwatch/browser-host/capabilities";
export {
  mergeUiPageLoaders,
  uiFeatureLoaders,
  type UiPageLoaderMerge,
} from "./behavior/ui-feature-loaders";
export {
  createUiFeatureApiClient,
  UI_TRPC_ENDPOINT,
  type UiFeatureApiBinding,
  type UiFeatureApiClientOptions,
  type UiFeatureApiProvider,
  type UiFeatureApiTransport,
} from "./behavior/ui-feature-transport";
export {
  installUiFeatures,
  uiFeature,
  type UiFeature,
  type UiFeatureInstall,
} from "./behavior/ui-feature";
export { createRouterUiNavigation, useRouterUiNavigation } from "./behavior/ui-router-navigation";
export { useUiOrgQueryParamSelection } from "./behavior/ui-scope-org-param";
export {
  organizationRoleOf,
  projectSlugAddressedBy,
  resolveUiScope,
  selectAmbientTeam,
  uiOrgQueryParamWrites,
  uiScopeSelectionWrites,
  userBelongsToTeam,
  userCanOpenTeam,
  type UiScopeResolutionInput,
  type UiScopeSelectionWrite,
} from "./behavior/ui-scope-resolution";
export {
  isUiPublicRoute,
  UI_ORG_QUERY_PARAM,
  UI_PUBLIC_ROUTES,
  useUiRouteReading,
  type UiRouteReading,
} from "./behavior/ui-scope-route";
export {
  broadcastUiScopeWrite,
  readUiScopeMemory,
  rememberUiScopeSelection,
  UI_SELECTED_ORGANIZATION_ID_KEY,
  UI_SELECTED_PROJECT_SLUG_KEY,
  UI_SELECTED_TEAM_ID_KEY,
  useUiScopeMemory,
  writeUiScopeSelection,
  type UiScopeMemory,
} from "./behavior/ui-scope-storage";
export {
  BrowserUiSession,
  readUiDemoProjectSlug,
  UI_SIGN_IN_PATH,
  UiFeatureFlagRequests,
  uiSignedOutDeparture,
  useBrowserUiSession,
  type BrowserUiSessionState,
  type UiSessionSource,
} from "./behavior/ui-session";
export {
  readUiActor,
  SessionReadFailedError,
  toUiActor,
  uiAuthClient,
  UI_SESSION_PATH,
  UI_SESSION_QUERY_KEY,
  type UiAuthClient,
  type UiSessionReading,
} from "@langwatch/auth-browser/session";
export {
  UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
  UI_FEATURE_FLAG_PROCEDURE,
  UI_ORGANIZATIONS_PROCEDURE,
  UI_SHARED_TRACE_PROCEDURE,
  useUiEffectivePermissions,
  useUiFeatureFlags,
  useUiOrganizations,
  useUiSharedProject,
  type UiSharedProject,
} from "./behavior/ui-session-queries";
export {
  UI_ORGANIZATION_ADMIN_ROLE,
  UI_RESERVED_PROJECT_SLUGS,
  type UiResolvedScope,
  type UiScopeOrganization,
  type UiScopeProject,
  type UiScopeRoute,
  type UiScopeSelection,
  type UiScopeTeam,
} from "./model/ui-scope";
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
} from "./shell/ui-route-table";
export type { UiApplication, UiApplicationInstall } from "./shell/ui-application";
export { createUiFeatureShell, type UiFeatureShellInstall } from "./shell/ui-feature-shell";
export { createUiInnerProvider, type UiInnerProviderInstall } from "./shell/ui-inner-providers";
export {
  createUiOuterProvider,
  type UiOuterProviderInstall,
  type UiProviderShell,
} from "./shell/ui-outer-providers";
export { createUiRouteObjects, type UiRouteObjectsOptions } from "./shell/ui-route-objects";
export { createUiRootLayout, type UiRootLayoutInstall } from "./shell/ui-root-layout";
// The contract itself, the meta tag that carries it and the deployment
// projection that builds it are `@langwatch/config/public-app-config` and its
// `/projection` subpath: the API writes the tag and this application reads it,
// so the shared half cannot live in a browser application. What is left here
// is the read.
export {
  readPublicAppConfig,
  type PublicEnvironment,
  toPublicEnvironment,
} from "./behavior/public-config";
