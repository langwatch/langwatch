/**
 * What both RBAC pages show an organization that is not on Enterprise. The
 * words belong to billing, which this package may not name, so they arrive
 * through the composition's `contactSales` slot; unfilled, no card shows.
 */

import { Box } from "@chakra-ui/react";
import { UiSlot } from "@langwatch/ui-host/slots";

/** The sales block, framed the way both pages framed it. */
export function EnterpriseUpsell() {
  return (
    <Box width="full">
      <UiSlot name="contactSales" props={{}} />
    </Box>
  );
}
