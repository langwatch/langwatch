import { z } from "zod";

import { limitTypeSchema } from "./license-limit-type.ts";
export const SEAT_LIMIT_REACHED_EVENT_TYPE = "lw.organization.seat_limit_reached" as const;
/** One seat limit an organization ran into: a refused invite, role change or client pre-check. */
export const seatLimitReachedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  limitType: limitTypeSchema,
  current: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
});
export type SeatLimitReachedEventData = z.infer<typeof seatLimitReachedEventDataSchema>;
