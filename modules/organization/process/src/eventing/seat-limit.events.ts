import { EventSchema } from "@langwatch/eventing";
import { limitTypeSchema } from "@langwatch/organization-contract";
import { z } from "zod";

export const SEAT_LIMIT_PIPELINE_NAME = "organization_seat_limit" as const;
export const SEAT_LIMIT_AGGREGATE_TYPE = "organization_seat_limit" as const;
export const SEAT_LIMIT_REACHED_EVENT_TYPE = "lw.organization.seat_limit_reached" as const;
export const SEAT_LIMIT_REACHED_EVENT_VERSION = "2026-09-28" as const;
export const RECORD_SEAT_LIMIT_REACHED_COMMAND_TYPE =
  "lw.organization.record_seat_limit_reached" as const;

/** One seat limit an organization ran into: a refused invite, role change or client pre-check. */
export const recordSeatLimitReachedCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  limitType: limitTypeSchema,
  current: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
});
export type RecordSeatLimitReachedCommandData = z.infer<
  typeof recordSeatLimitReachedCommandDataSchema
>;

export const seatLimitReachedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SEAT_LIMIT_REACHED_EVENT_TYPE),
  version: z.literal(SEAT_LIMIT_REACHED_EVENT_VERSION),
  data: recordSeatLimitReachedCommandDataSchema,
});
export type SeatLimitReachedEvent = z.infer<typeof seatLimitReachedEventSchema>;
