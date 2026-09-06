/**
 * The AI Gateway experience, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole section is one entry. What it exposes is a
 * loader per page rather than ten components: the section is six thousand lines
 * and the key detail page alone is a thousand, and a barrel of components would
 * put all of it in one chunk the moment any address under /gateway is opened. A
 * loader keeps the split the application already had.
 *
 * The keys are this package's names for its own pages. Which URL each answers
 * is `apps/ui`'s to decide — the route table names a page key, the frontend
 * feature maps that key onto one of these, and neither half learns the other's
 * vocabulary. `/gateway` itself is not here: it was a component whose whole
 * body was a redirect to `/gateway/virtual-keys`, and a redirect is a row in a
 * route table rather than a screen.
 *
 * `gatewayApi` and `GatewayHostProvider` are the two things the owning frontend
 * feature has to mount around them: the tRPC Provider the screens' hooks run
 * on, and the port that answers for the session, the address, the plan and the
 * toasts.
 */

import type { ComponentType } from "react";

export type GatewayScreenLoader = () => Promise<{ default: ComponentType }>;

export const gatewayScreens = {
  virtualKeys: () => import("./gateway-virtual-keys.screen.tsx"),
  virtualKey: () => import("./gateway-virtual-key.screen.tsx"),
  budgets: () => import("./gateway-budgets.screen.tsx"),
  budget: () => import("./gateway-budget.screen.tsx"),
  routingPolicies: () => import("./gateway-routing-policies.screen.tsx"),
  usage: () => import("./gateway-usage.screen.tsx"),
  cacheRules: () => import("./gateway-cache-rules.screen.tsx"),
  guardrails: () => import("./gateway-guardrails.screen.tsx"),
  billingEvents: () => import("./gateway-billing-events.screen.tsx"),
  webhooks: () => import("./gateway-webhooks.screen.tsx"),
} as const satisfies Record<string, GatewayScreenLoader>;

export type GatewayScreenName = keyof typeof gatewayScreens;

export { gatewayApi } from "../../behavior/gateway-api.ts";
export {
  GatewayHostPort,
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
} from "../../model/gateway-host.ts";
