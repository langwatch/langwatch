/**
 * The routing-policy editor, mounted in the host its package asks for.
 *
 * ONE WAY IN, FOR EVERY CALLER. The Routing Policies screen used to render this
 * same editor inline off a `?policy=<id>` key of its own, so the editor had two
 * addresses and a virtual key's detail page — which links to
 * `/gateway/routing-policies?drawer.open=routingPolicy&drawer.policyId=<id>`
 * for the policy that key routes through — landed on the one nothing answered.
 * The screen names the drawer now and its host writes the registry's address,
 * so a row click and that link are the same link.
 *
 * The component does not close itself — the drawers doc's rule, since a target
 * that calls `closeDrawer` clears the caller's stack too — so the close is
 * passed in, and here that is the navigator's own.
 */

import { RoutingPolicyDrawer as RoutingPolicy } from "@langwatch/gateway-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withHost } from "../../../../ui/sections/ui-page";
import { GatewayHost } from "./gateway-host";

/** The four scalars the address can carry, as the editor names them. */
type RoutingPolicyAddress = {
  policyId?: string;
  seedScopeType?: string;
  seedScopeId?: string;
  seedIsDefault?: string;
};

function RoutingPolicyFromAddress(address: RoutingPolicyAddress) {
  const { closeDrawer } = useDrawer();

  return (
    <RoutingPolicy
      {...(address.policyId ? { policyId: address.policyId } : {})}
      {...(address.seedScopeType ? { seedScopeType: address.seedScopeType } : {})}
      {...(address.seedScopeId ? { seedScopeId: address.seedScopeId } : {})}
      {...(address.seedIsDefault ? { seedIsDefault: address.seedIsDefault } : {})}
      onClose={closeDrawer}
    />
  );
}

export const RoutingPolicyDrawer = withHost(GatewayHost, RoutingPolicyFromAddress);
