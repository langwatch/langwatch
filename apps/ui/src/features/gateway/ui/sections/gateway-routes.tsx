/**
 * Which page key each gateway screen answers, and what it is wrapped in.
 *
 * The route table names ten page keys under `/gateway`; the package exposes ten
 * loaders under names of its own. This is the map between them, and the only
 * place either vocabulary meets the other. `/gateway` itself is not here: it is
 * a redirect row in the table, which is what a page whose whole body was a
 * `router.replace` should have been all along.
 *
 * THE PERMISSIONS ARE THE PLATFORM PAGES', ONE FOR ONE. The webhooks page is
 * the one with none, and that is not an oversight: it opened for anyone in the
 * organization, showed the Enterprise upsell to a plan without the entitlement,
 * and asked `webhookEndpoints:manage` for its own controls. Adding a view grant
 * here would refuse readers the platform page admitted.
 */

import type { ComponentType } from "react";
import { gatewayScreens, type GatewayScreenName } from "@langwatch/gateway-web/screens/gateway";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { GatewayHost } from "./gateway-host";

/**
 * Routing policies are the one gateway page behind a flag, and it is the
 * governance section's flag rather than a gateway one: the editor was a
 * `/settings/governance` page until the addresses moved, and the flag moved
 * with it. Spec: specs/navigation/gateway-url-move.feature.
 */
const ROUTING_POLICIES_FLAG = "release_ui_ai_governance_enabled";

function gatewayPage(
  screen: GatewayScreenName,
  policy: { permission?: string; flags?: readonly string[] } = {},
): UiPageLoader {
  return uiPage({
    screen: async () => ({ default: (await gatewayScreens[screen]()).default as ComponentType }),
    host: GatewayHost,
    ...policy,
  });
}

export const gatewayPageLoaders: UiPageLoaderRegistry = {
  "pages/gateway/virtual-keys": gatewayPage("virtualKeys", { permission: "virtualKeys:view" }),
  "pages/gateway/virtual-keys/[id]": gatewayPage("virtualKey", {
    permission: "virtualKeys:view",
  }),
  "pages/gateway/budgets": gatewayPage("budgets", { permission: "gatewayBudgets:view" }),
  "pages/gateway/budgets/[id]": gatewayPage("budget", { permission: "gatewayBudgets:view" }),
  "pages/gateway/routing-policies": gatewayPage("routingPolicies", {
    permission: "routingPolicies:view",
    flags: [ROUTING_POLICIES_FLAG],
  }),
  "pages/gateway/usage": gatewayPage("usage", { permission: "gatewayUsage:view" }),
  "pages/gateway/cache-rules": gatewayPage("cacheRules", {
    permission: "gatewayCacheRules:view",
  }),
  "pages/gateway/guardrails": gatewayPage("guardrails", {
    permission: "gatewayGuardrails:view",
  }),
  "pages/gateway/billing-events": gatewayPage("billingEvents", {
    permission: "gatewayUsage:view",
  }),
  "pages/gateway/webhooks": gatewayPage("webhooks"),
};
