/**
 * Which page key each gateway screen answers. Webhooks carries no
 * permission on purpose, matching the platform page: it opens for anyone
 * and asks `webhookEndpoints:manage` only for its own controls.
 */

import type { ComponentType } from "react";
import { gatewayScreens, type GatewayScreenName } from "@langwatch/gateway-web/screens/gateway";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { GatewayHost } from "./gateway-host";

/** Routing policies' flag is governance's, not gateway's — the editor was a `/settings/governance` page before the address moved. */
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
