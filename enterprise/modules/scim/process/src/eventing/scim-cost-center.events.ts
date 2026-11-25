// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_COST_CENTER_CHANGED_EVENT_TYPE,
  SCIM_COST_CENTER_CHANGED_EVENT_VERSION,
  scimCostCenterChangedEventDataSchema,
} from "@langwatch/enterprise-scim-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_COST_CENTER_CHANGED_COMMAND_TYPE =
  "lw.scim.record_cost_center_changed" as const;

export const recordCostCenterChangedCommandDataSchema = scimCostCenterChangedEventDataSchema;
export type RecordCostCenterChangedCommandData = z.infer<
  typeof recordCostCenterChangedCommandDataSchema
>;

export const scimCostCenterChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SCIM_COST_CENTER_CHANGED_EVENT_TYPE),
  version: z.literal(SCIM_COST_CENTER_CHANGED_EVENT_VERSION),
  data: scimCostCenterChangedEventDataSchema,
});
export type ScimCostCenterChangedEvent = z.infer<typeof scimCostCenterChangedEventSchema>;
