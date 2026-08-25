import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";
import {
  recordBudgetCrossingCommandDataSchema,
  recordVkLifecycleCommandDataSchema,
} from "./commands";
import {
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
} from "./constants";

export const governanceVkLifecycleEventSchema = EventSchema.extend({
  type: z.literal(GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE),
  data: recordVkLifecycleCommandDataSchema,
});
export type GovernanceVkLifecycleEvent = z.infer<typeof governanceVkLifecycleEventSchema>;

export const governanceBudgetCrossingEventSchema = EventSchema.extend({
  type: z.literal(GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE),
  data: recordBudgetCrossingCommandDataSchema,
});
export type GovernanceBudgetCrossingEvent = z.infer<
  typeof governanceBudgetCrossingEventSchema
>;

export type GovernanceEventsProcessingEvent =
  | GovernanceVkLifecycleEvent
  | GovernanceBudgetCrossingEvent;
