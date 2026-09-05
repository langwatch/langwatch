/**
 * What billing puts in the slot every core screen that hits an Enterprise wall
 * leaves open. Design: dev/docs/plans/ui-slots-2026-09-05.md
 */

import { ContactSalesBlock } from "@langwatch/enterprise-billing-web/surfaces/contact-sales";
import type { UiSlotComponents } from "@langwatch/ui-host/slots";

export const billingUiSlots: UiSlotComponents = { contactSales: ContactSalesBlock };
