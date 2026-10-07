// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** SCIM's cost-center fact: governance assigns the department from its own side (§9). */
export const SCIM_COST_CENTER_PIPELINE_NAME = "scim_cost_center" as const;
export const SCIM_MEMBER_AGGREGATE_TYPE = "scim_member" as const;
export const SCIM_COST_CENTER_CHANGED_EVENT_TYPE = "lw.scim.cost_center_changed" as const;
export const SCIM_COST_CENTER_CHANGED_EVENT_VERSION = "2026-10-07" as const;

/** `costCenter` is trimmed; null clears the member's department. */
export const scimCostCenterChangedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  costCenter: z.string().min(1).nullable(),
  occurredAt: z.number().int().nonnegative(),
});
export type ScimCostCenterChangedEventData = z.infer<typeof scimCostCenterChangedEventDataSchema>;
