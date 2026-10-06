/**
 * What both RBAC pages show an organization that is not on Enterprise. The
 * words belong to billing, which lends the card by token; unlent, none shows.
 */

import { Lent } from "@langwatch/browser-host/lent";
import { Box } from "@langwatch/design-system/primitives";
import { ContactSalesToken } from "@langwatch/enterprise-billing-contract";

/** The sales block, framed the way both pages framed it. */
export function EnterpriseUpsell() {
  return (
    <Box width="full">
      <Lent of={ContactSalesToken} props={{}} />
    </Box>
  );
}
