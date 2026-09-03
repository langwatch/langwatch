/**
 * The routing-policy editor, mounted in the host its package asks for.
 *
 * TWO WAYS IN, ONE COMPONENT, AND THEY DO NOT COLLIDE. The Routing Policies
 * screen renders this same editor inline off its own `?policy=<id>` key, which
 * is how a reader opens it from a row on the page that owns those rows. This
 * registration answers the OTHER caller: a virtual key's detail page links to
 * `/gateway/routing-policies?drawer.open=routingPolicy&drawer.policyId=<id>`
 * for the policy that key routes through, and that link opened nothing. Nothing
 * mints both keys, so a URL opens exactly one editor.
 *
 * The component does not close itself — the drawers doc's rule, since a target
 * that calls `closeDrawer` clears the caller's stack too — so the close is
 * passed in, and here that is the navigator's own.
 */

import { RoutingPolicyDrawer as RoutingPolicy } from "@langwatch/gateway-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withGatewayHost } from "./gateway-host-provider";

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

export const RoutingPolicyDrawer = withGatewayHost(RoutingPolicyFromAddress);
