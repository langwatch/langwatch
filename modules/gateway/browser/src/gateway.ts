/**
 * The AI Gateway experience, as the browser application mounts it. Screen
 * loaders are exported per page to avoid one monolithic chunk. gatewayApi and
 * GatewayHostProvider must wrap these screens.
 */

import type { ComponentType } from "react";

export type GatewayScreenLoader = () => Promise<{ default: ComponentType }>;

export const gatewayScreens = {
  virtualKeys: () => import("./ui/sections/gateway/gateway-virtual-keys.screen.tsx"),
  virtualKey: () => import("./ui/sections/gateway/gateway-virtual-key.screen.tsx"),
  budgets: () => import("./ui/sections/gateway/gateway-budgets.screen.tsx"),
  budget: () => import("./ui/sections/gateway/gateway-budget.screen.tsx"),
  routingPolicies: () => import("./ui/sections/gateway/gateway-routing-policies.screen.tsx"),
  usage: () => import("./ui/sections/gateway/gateway-usage.screen.tsx"),
  cacheRules: () => import("./ui/sections/gateway/gateway-cache-rules.screen.tsx"),
  guardrails: () => import("./ui/sections/gateway/gateway-guardrails.screen.tsx"),
  billingEvents: () => import("./ui/sections/gateway/gateway-billing-events.screen.tsx"),
  webhooks: () => import("./ui/sections/gateway/gateway-webhooks.screen.tsx"),
} as const satisfies Record<string, GatewayScreenLoader>;

export type GatewayScreenName = keyof typeof gatewayScreens;

export { gatewayApi } from "./behavior/gateway-api.ts";
export {
  GatewayHostApi,
  GatewayHostProvider,
  type GatewayActor,
  type GatewayDeployment,
  type GatewayFailureNotice,
  type GatewayOrganization,
  type GatewayPlan,
  type GatewayProject,
  type GatewayRouteReading,
  type GatewayDrawer,
  type GatewayScope,
  type GatewaySuccessNotice,
  type GatewayTeam,
} from "./model/gateway-host.ts";
