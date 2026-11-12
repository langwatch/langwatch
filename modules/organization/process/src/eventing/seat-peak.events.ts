import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

import { seatHolderSchema, seatKindSchema } from "../rules/seat-holder.rules.ts";

/** The seat-peak pipeline's facts: every seat change and the opening count (ADR-002). */
export const SEAT_PEAK_PIPELINE_NAME = "organization_seat_peak" as const;
export const SEAT_PEAK_AGGREGATE_TYPE = "organization_seat_peak" as const;

export const SEAT_CHANGED_EVENT_TYPE = "lw.organization.seat_changed" as const;
export const SEAT_CHANGED_EVENT_VERSION = "2026-11-02" as const;
export const SEAT_SNAPSHOT_TAKEN_EVENT_TYPE = "lw.organization.seat_snapshot_taken" as const;
export const SEAT_SNAPSHOT_TAKEN_EVENT_VERSION = "2026-11-02" as const;

export const RECORD_SEAT_CHANGED_COMMAND_TYPE = "lw.organization.record_seat_changed" as const;
export const RECORD_SEAT_SNAPSHOT_COMMAND_TYPE = "lw.organization.record_seat_snapshot" as const;

/** What moved the seat: the audit trail the members table lacks, never read by the fold. */
export const seatChangeCauseSchema = z.enum([
  "organization_created",
  "admitted",
  "invited",
  "invitation_accepted",
  "invitation_revoked",
  "payment_approved",
  "role_changed",
  "custom_role_changed",
  "disabled",
  "enabled",
  "removed",
  "account_deactivated",
  "account_reactivated",
  "directory_created",
]);
export type SeatChangeCause = z.infer<typeof seatChangeCauseSchema>;

export const recordSeatChangedCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  holder: seatHolderSchema,
  from: seatKindSchema,
  to: seatKindSchema,
  cause: seatChangeCauseSchema,
  /** Who made the change; absent for one no person made (a directory, a sign-up). */
  actorUserId: z.string().min(1).nullish(),
  occurredAt: z.number().int().nonnegative(),
  /** Minted where the change was committed, so a redelivery records nothing new. */
  changeId: z.string().min(1),
  /** A hold giving its seat to a live full invitation to its address: that invitation's id. */
  suppressedByInviteId: z.string().min(1).optional(),
});
export type RecordSeatChangedCommandData = z.infer<typeof recordSeatChangedCommandDataSchema>;

export const recordSeatSnapshotCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  holders: z.array(z.object({ holder: seatHolderSchema, seat: seatKindSchema })),
  occurredAt: z.number().int().nonnegative(),
});
export type RecordSeatSnapshotCommandData = z.infer<typeof recordSeatSnapshotCommandDataSchema>;

export const seatChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SEAT_CHANGED_EVENT_TYPE),
  version: z.literal(SEAT_CHANGED_EVENT_VERSION),
  data: recordSeatChangedCommandDataSchema,
});
export type SeatChangedEvent = z.infer<typeof seatChangedEventSchema>;

export const seatSnapshotTakenEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SEAT_SNAPSHOT_TAKEN_EVENT_TYPE),
  version: z.literal(SEAT_SNAPSHOT_TAKEN_EVENT_VERSION),
  data: recordSeatSnapshotCommandDataSchema,
});
export type SeatSnapshotTakenEvent = z.infer<typeof seatSnapshotTakenEventSchema>;
