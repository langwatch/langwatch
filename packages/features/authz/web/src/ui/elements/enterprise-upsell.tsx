/**
 * What both RBAC pages show an organization that is not on Enterprise.
 *
 * ONE MODULE NAMES THE ENTERPRISE PACKAGE, and that is the whole reason this
 * file exists. `ui-screen-closure` counts import LINES, so the two screens
 * naming `@langwatch/enterprise-billing-web` directly would be two findings
 * where routing both through here is one — the same accounting the
 * model-provider family used to put a shared type behind the one module that
 * already had to name a surface.
 *
 * THE IMPORT IS A RECORDED COST, NOT AN OVERSIGHT. `@langwatch/authz-web` is a
 * CORE package and this is an ENTERPRISE one, which is the `enterprise-direction`
 * finding `@langwatch/gateway-web` already carries for the same block on its
 * webhooks screen. Neither this package nor `apps/ui` may hold the sales copy —
 * both are core — so the alternative is a family-local copy of a block that
 * exists to say one thing about BILLING, which is not this feature's subject.
 * It clears when `packages/enterprise/composition/ui` exists, the same
 * structural gate that blocks the billing settings family entirely.
 */

import { Box } from "@chakra-ui/react";
import { ContactSalesBlock } from "@langwatch/enterprise-billing-web";

/** The sales block, framed the way both pages framed it. */
export function EnterpriseUpsell() {
  return (
    <Box width="full">
      <ContactSalesBlock />
    </Box>
  );
}
