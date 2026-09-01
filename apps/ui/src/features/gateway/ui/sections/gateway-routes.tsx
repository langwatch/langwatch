/**
 * Which page key each gateway screen answers, and what it is wrapped in.
 *
 * The route table names ten page keys under `/gateway`; the package exposes ten
 * loaders under names of its own. This is the map between them, and the only
 * place either vocabulary meets the other. `/gateway` itself is not here: it is
 * a redirect row in the table, which is what a page whose whole body was a
 * `router.replace` should have been all along.
 *
 * Each page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the gateway host, but a page that opens needs the host mounted
 * above it before its first render. Inside that, the guard states the policy
 * the two platform higher-order components used to carry — the page's flag
 * where it has one, then the grant — with the flag reading as a 404 for
 * everyone before any permission is considered.
 *
 * THE PERMISSIONS ARE THE PLATFORM PAGES', ONE FOR ONE. The webhooks page is
 * the one with none, and that is not an oversight: it opened for anyone in the
 * organization, showed the Enterprise upsell to a plan without the entitlement,
 * and asked `webhookEndpoints:manage` for its own controls. Adding a view grant
 * here would refuse readers the platform page admitted.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import type { ComponentType } from "react";
import { gatewayScreens, type GatewayScreenName } from "@langwatch/gateway-web/screens/gateway";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withGatewayHost } from "./gateway-host-provider";

/**
 * Routing policies are the one gateway page behind a flag, and it is the
 * governance section's flag rather than a gateway one: the editor was a
 * `/settings/governance` page until the addresses moved, and the flag moved
 * with it. Spec: specs/navigation/gateway-url-move.feature.
 */
const ROUTING_POLICIES_FLAG = "release_ui_ai_governance_enabled";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

function gatewayPage(
  screen: GatewayScreenName,
  policy: { permission?: string; flags?: readonly string[] } = {},
): UiPageLoader {
  return async () => {
    const module = await gatewayScreens[screen]();
    const guarded = withUiPageGuard({ ...policy, fallbacks: FALLBACKS })(
      module.default as ComponentType,
    );
    return { default: withGatewayHost(guarded) };
  };
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
