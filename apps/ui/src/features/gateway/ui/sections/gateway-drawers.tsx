/**
 * The routing-policy editor, mounted in the host its package asks for. One
 * address for every caller — a row click and a virtual key's detail-page
 * link both resolve `?drawer.open=routingPolicy&drawer.policyId=<id>`.
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
