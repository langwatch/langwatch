/**
 * The Ops seat sharing check: per organization on a paid plan, the distinct people active
 * in the last 30 days beside its paid full seats. Ops staff only, never shown to customers.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The rolling window the check counts people over, in days. */
export const SEAT_SHARING_WINDOW_DAYS = 30;

/** An organization is flagged when its active people go over this many times its seats. */
export const SEAT_SHARING_FLAG_RATIO = 2;

const seatSharingReadingSchemaDefinition = z.object({
  organizationId: z.string(),
  planName: z.string(),
  /** Paid full seats, the plan's `maxMembers`. */
  seats: z.number().int().nonnegative(),
  /** Distinct people who held a seat in the window and signed in or used a session in it. */
  activePeople: z.number().int().nonnegative(),
  flagged: z.boolean(),
});
export interface SeatSharingReadingSchema extends Named<
  typeof seatSharingReadingSchemaDefinition
> {}
export const seatSharingReadingSchema: SeatSharingReadingSchema =
  seatSharingReadingSchemaDefinition;
export type SeatSharingReading = z.infer<typeof seatSharingReadingSchema>;

const seatSharingCheckSchemaDefinition = z.object({
  /** When the check finished, epoch ms. */
  checkedAt: z.number().int(),
  windowDays: z.number().int().positive(),
  /** One reading per organization on a paid plan; free organizations are not checked. */
  readings: z.array(seatSharingReadingSchema),
});
export interface SeatSharingCheckSchema extends Named<typeof seatSharingCheckSchemaDefinition> {}
export const seatSharingCheckSchema: SeatSharingCheckSchema = seatSharingCheckSchemaDefinition;
export type SeatSharingCheck = z.infer<typeof seatSharingCheckSchema>;
