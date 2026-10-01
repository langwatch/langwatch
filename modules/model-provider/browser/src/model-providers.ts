// Per ADR-004, exports screen loaders (not components) for two addresses:
// /settings/model-providers and /settings/model-costs

export { modelProviderApi } from "./behavior/model-provider-api.ts";
export {
  MODEL_COST_MANAGE_PERMISSION,
  MODEL_PROVIDER_MANAGE_PERMISSION,
  MODEL_PROVIDER_SCOPE_QUERY_KEY,
  ModelProviderHostApi,
  ModelProviderHostProvider,
  type ModelProviderAvailableScopes,
  type ModelProviderFailureNotice,
  type ModelProviderHostScope,
  type ModelProviderPlatformDrawer,
  type ModelProviderRouteReading,
  type ModelProviderSuccessNotice,
} from "./model/model-provider-host.ts";
