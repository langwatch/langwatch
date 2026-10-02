import { EventSchema } from "@langwatch/eventing";
import {
  SEAT_LIMIT_REACHED_EVENT_TYPE,
  seatLimitReachedEventDataSchema,
} from "@langwatch/organization-contract";
import { z } from "zod";

export const SEAT_LIMIT_PIPELINE_NAME = "organization_seat_limit" as const;
export const SEAT_LIMIT_AGGREGATE_TYPE = "organization_seat_limit" as const;
export const SEAT_LIMIT_REACHED_EVENT_VERSION = "2026-09-28" as const;
export const RECORD_SEAT_LIMIT_REACHED_COMMAND_TYPE =
  "lw.organization.record_seat_limit_reached" as const;

/** The command carries the event's data, which organization's contract declares for its peers. */
export const recordSeatLimitReachedCommandDataSchema = seatLimitReachedEventDataSchema;
export type RecordSeatLimitReachedCommandData = z.infer<
  typeof recordSeatLimitReachedCommandDataSchema
>;

export const seatLimitReachedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SEAT_LIMIT_REACHED_EVENT_TYPE),
  version: z.literal(SEAT_LIMIT_REACHED_EVENT_VERSION),
  data: seatLimitReachedEventDataSchema,
});
export type SeatLimitReachedEvent = z.infer<typeof seatLimitReachedEventSchema>;
