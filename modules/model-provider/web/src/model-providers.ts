// Per ADR-004, exports screen loaders (not components) for two addresses:
// /settings/model-providers and /settings/model-costs

import type { ComponentType } from "react";

export type ModelProviderScreenLoader = () => Promise<{ default: ComponentType }>;

export const modelProviderScreens = {
  modelProviders: () => import("./ui/sections/model-providers-screen.tsx"),
  modelCosts: () => import("./ui/sections/model-costs-screen.tsx"),
} as const satisfies Record<string, ModelProviderScreenLoader>;

export type ModelProviderScreenName = keyof typeof modelProviderScreens;

export {
  MODEL_PROVIDER_MANAGE_PERMISSION,
  MODEL_PROVIDER_SCOPE_QUERY_KEY,
} from "./ui/sections/model-providers-screen.tsx";
export { MODEL_COST_MANAGE_PERMISSION } from "./ui/sections/model-costs-screen.tsx";
export { modelProviderApi } from "./behavior/model-provider-api.ts";
export {
  ModelProviderHostApi,
  ModelProviderHostProvider,
  type ModelProviderAvailableScopes,
  type ModelProviderFailureNotice,
  type ModelProviderHostScope,
  type ModelProviderPlatformDrawer,
  type ModelProviderRouteReading,
  type ModelProviderSuccessNotice,
} from "./model/model-provider-host.ts";
