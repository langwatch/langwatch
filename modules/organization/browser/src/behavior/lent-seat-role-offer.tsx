/** What billing lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { SeatRoleOfferToken, type SeatRoleOfferProps } from "@langwatch/enterprise-billing-client";

/** Billing's offer of the full seat a role change needs, rendered as billing lends it. */
export function SeatRoleOffer(props: SeatRoleOfferProps) {
  return <Lent of={SeatRoleOfferToken} props={props} />;
}
