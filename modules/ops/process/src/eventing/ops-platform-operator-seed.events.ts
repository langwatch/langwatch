import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const PLATFORM_OPERATOR_SEED_AGGREGATE_TYPE = "platform_operator_seed";
export const PLATFORM_OPERATOR_SEED_RECORDED_EVENT_TYPE = "lw.ops.platform_operator_seed.recorded";
export const PLATFORM_OPERATOR_SEED_RECORDED_EVENT_VERSION = "2026-10-01";

/** The seed decided, once: who it granted (possibly nobody) and by which rule. */
export const platformOperatorSeedRecordedEventDataSchema = z.object({
  via: z.enum(["admin-emails", "sole-organization-admin", "none"]),
  userIds: z.array(z.string()),
});

export const platformOperatorSeedRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PLATFORM_OPERATOR_SEED_RECORDED_EVENT_TYPE),
  version: z.literal(PLATFORM_OPERATOR_SEED_RECORDED_EVENT_VERSION),
  data: platformOperatorSeedRecordedEventDataSchema,
});
export type PlatformOperatorSeedRecordedEvent = z.infer<
  typeof platformOperatorSeedRecordedEventSchema
>;
