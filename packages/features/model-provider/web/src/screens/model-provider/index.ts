/**
 * The Model Provider settings family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for each
 * page is a LOADER rather than a component, because between them the two screens
 * drag sixteen provider marks, a cascade table and a confirm dialog behind them,
 * and none of that belongs in the chunk that renders the rest of the
 * application.
 *
 * TWO SCREENS, TWO ADDRESSES: `/settings/model-providers` and
 * `/settings/model-costs`.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC Provider
 * this package's hooks run on, and the host port that answers for the scope, the
 * reader's grants, the scopes they can see, the address, the two notices, and
 * the three `platform/app` drawers these screens address rather than mount.
 */

import type { ComponentType } from "react";

export type ModelProviderScreenLoader = () => Promise<{ default: ComponentType }>;

export const modelProviderScreens = {
  modelProviders: () => import("./model-providers.screen"),
  modelCosts: () => import("./model-costs.screen"),
} as const satisfies Record<string, ModelProviderScreenLoader>;

export type ModelProviderScreenName = keyof typeof modelProviderScreens;

export {
  MODEL_PROVIDER_MANAGE_PERMISSION,
  MODEL_PROVIDER_SCOPE_QUERY_KEY,
} from "./model-providers.screen";
export { MODEL_COST_MANAGE_PERMISSION } from "./model-costs.screen";
export { modelProviderApi } from "../../behavior/model-provider-api";
export {
  ModelProviderHostPort,
  ModelProviderHostProvider,
  type ModelProviderAvailableScopes,
  type ModelProviderFailureNotice,
  type ModelProviderHostScope,
  type ModelProviderPlatformDrawer,
  type ModelProviderRouteReading,
  type ModelProviderSuccessNotice,
} from "../../model/model-provider-host";
