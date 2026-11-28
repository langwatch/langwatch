/**
 * A role change that needs one more full seat, bought and applied together
 * (specs/licensing/role-change-seat.feature). A change waiting on a payment applies once,
 * whichever of the paid fact and the admin's return arrives first.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { organizationApiMemberRoleSchema } from "./organization.trpc-schemas.ts";

const changeMemberRoleWithSeatInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    role: organizationApiMemberRoleSchema,
    /** The instant the seat quote on screen was priced, so the charge matches it. */
    quotedAt: z.number().int().positive().optional(),
  })
  .strict();
export interface ChangeMemberRoleWithSeatInputSchema extends Named<
  typeof changeMemberRoleWithSeatInputSchemaDefinition
> {}
export const changeMemberRoleWithSeatInputSchema: ChangeMemberRoleWithSeatInputSchema =
  changeMemberRoleWithSeatInputSchemaDefinition;
export type ChangeMemberRoleWithSeatInput = z.infer<typeof changeMemberRoleWithSeatInputSchema>;

/**
 * Changed now (with a seat bought or a free one used), waiting on a payment page, or the seat
 * paid while the role change was then refused (`reason` says why; the seat stays).
 */
const memberRoleWithSeatResultSchemaDefinition = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("changed"),
      seatAdded: z.boolean(),
      teamsLeftWithoutAdmin: z.array(
        z.object({ id: z.string().min(1), name: z.string() }).strict(),
      ),
    })
    .strict(),
  z
    .object({
      status: z.literal("payment_required"),
      changeId: z.string().min(1),
      url: z.string().url(),
    })
    .strict(),
  z.object({ status: z.literal("seat_only"), reason: z.string() }).strict(),
]);
export interface MemberRoleWithSeatResultSchema extends Named<
  typeof memberRoleWithSeatResultSchemaDefinition
> {}
export const memberRoleWithSeatResultSchema: MemberRoleWithSeatResultSchema =
  memberRoleWithSeatResultSchemaDefinition;
export type MemberRoleWithSeatResult = z.infer<typeof memberRoleWithSeatResultSchema>;

/** Where a change waiting on a payment stands; `superseded` when a later role write replaced it. */
export const seatRoleChangeStatusSchema = z.enum([
  "waiting",
  "applied",
  "failed",
  "seat_only",
  "superseded",
]);
export type SeatRoleChangeStatus = z.infer<typeof seatRoleChangeStatusSchema>;

/** A role change the seat offer refused for two live subscriptions, kept for its admin. */
const recordBlockedRoleChangeInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    role: organizationApiMemberRoleSchema,
  })
  .strict();
export interface RecordBlockedRoleChangeInputSchema extends Named<
  typeof recordBlockedRoleChangeInputSchemaDefinition
> {}
export const recordBlockedRoleChangeInputSchema: RecordBlockedRoleChangeInputSchema =
  recordBlockedRoleChangeInputSchemaDefinition;

const recordBlockedRoleChangeResultSchemaDefinition = z.object({ recorded: z.boolean() }).strict();
export interface RecordBlockedRoleChangeResultSchema extends Named<
  typeof recordBlockedRoleChangeResultSchemaDefinition
> {}
export const recordBlockedRoleChangeResultSchema: RecordBlockedRoleChangeResultSchema =
  recordBlockedRoleChangeResultSchemaDefinition;

const completeSeatRoleChangeInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), changeId: z.string().min(1) })
  .strict();
export interface CompleteSeatRoleChangeInputSchema extends Named<
  typeof completeSeatRoleChangeInputSchemaDefinition
> {}
export const completeSeatRoleChangeInputSchema: CompleteSeatRoleChangeInputSchema =
  completeSeatRoleChangeInputSchemaDefinition;

const seatRoleChangeOutcomeSchemaDefinition = z
  .object({ status: seatRoleChangeStatusSchema, reason: z.string().nullable() })
  .strict();
export interface SeatRoleChangeOutcomeSchema extends Named<
  typeof seatRoleChangeOutcomeSchemaDefinition
> {}
export const seatRoleChangeOutcomeSchema: SeatRoleChangeOutcomeSchema =
  seatRoleChangeOutcomeSchemaDefinition;
export type SeatRoleChangeOutcome = z.infer<typeof seatRoleChangeOutcomeSchema>;

/** The member's latest change waiting on (or settled by) a payment; null when there is none. */
const pendingSeatRoleChangeSchemaDefinition = z
  .object({
    changeId: z.string().min(1),
    role: organizationApiMemberRoleSchema,
    url: z.string().url(),
    status: seatRoleChangeStatusSchema,
    /** Why the role was not changed once the seat was paid; null otherwise. */
    reason: z.string().nullable(),
  })
  .strict()
  .nullable();
export interface PendingSeatRoleChangeSchema extends Named<
  typeof pendingSeatRoleChangeSchemaDefinition
> {}
export const pendingSeatRoleChangeSchema: PendingSeatRoleChangeSchema =
  pendingSeatRoleChangeSchemaDefinition;
export type PendingSeatRoleChange = z.infer<typeof pendingSeatRoleChangeSchema>;
