/**
 * What billing puts in the slot every core screen that hits an Enterprise wall
 * leaves open. Design: dev/docs/best_practices/ui-install.md
 */

import { ContactSalesBlock } from "@langwatch/enterprise-billing-web/surfaces/contact-sales";
import { SeatProrationPreview } from "@langwatch/enterprise-billing-web/surfaces/seat-proration-preview";
import type { UiSlotComponents } from "@langwatch/ui-host/slots";

export const billingUiSlots: UiSlotComponents = {
  contactSales: ContactSalesBlock,
  seatProrationPreview: SeatProrationPreview,
};
