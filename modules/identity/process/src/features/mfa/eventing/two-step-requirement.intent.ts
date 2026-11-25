import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

export const TWO_STEP_REQUIREMENT_PIPELINE_NAME = "identity_two_step_requirement" as const;
export const TWO_STEP_REQUIREMENT_AGGREGATE_TYPE = "organization_two_step_requirement" as const;
export const TWO_STEP_REQUIREMENT_CHANGED_EVENT_TYPE =
  "lw.identity.two_step_requirement_changed" as const;
const TWO_STEP_REQUIREMENT_CHANGED_EVENT_VERSION = "2026-10-10" as const;
const RECORD_TWO_STEP_REQUIREMENT_CHANGED_COMMAND_TYPE =
  "lw.identity.record_two_step_requirement_changed" as const;

export const twoStepRequirementChangedDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  required: z.boolean(),
  actorUserId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type TwoStepRequirementChangedData = z.infer<typeof twoStepRequirementChangedDataSchema>;

export const twoStepRequirementChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(TWO_STEP_REQUIREMENT_CHANGED_EVENT_TYPE),
  version: z.literal(TWO_STEP_REQUIREMENT_CHANGED_EVENT_VERSION),
  data: twoStepRequirementChangedDataSchema,
});
export type TwoStepRequirementChangedEvent = z.infer<typeof twoStepRequirementChangedEventSchema>;

/**
 * Records that an administrator turned an organization's two-step requirement on or off. The
 * aggregate is the organization; a redelivered command for the same moment records nothing new.
 */
export class RecordTwoStepRequirementChangedCommand implements CommandHandler<
  Command<TwoStepRequirementChangedData>,
  TwoStepRequirementChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_TWO_STEP_REQUIREMENT_CHANGED_COMMAND_TYPE,
    twoStepRequirementChangedDataSchema,
    "Record that an organization's two-step verification requirement changed",
  );

  async handle(
    command: Command<TwoStepRequirementChangedData>,
  ): Promise<TwoStepRequirementChangedEvent[]> {
    const data = command.data;
    return [
      EventUtils.createEvent<TwoStepRequirementChangedEvent>({
        aggregateType: TWO_STEP_REQUIREMENT_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: TWO_STEP_REQUIREMENT_CHANGED_EVENT_TYPE,
        version: TWO_STEP_REQUIREMENT_CHANGED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.required}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: TwoStepRequirementChangedData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(
    payload: TwoStepRequirementChangedData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.two_step_requirement.required": payload.required,
    };
  }
}
