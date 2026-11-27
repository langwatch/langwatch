/**
 * The people ops functions (ADR-202): invitations, members, one account by exact email, and the
 * organizations over their seat cap. Ids, roles, states, counts and times only.
 * Spec: modules/staff-access/specs/staff-access-functions-people.feature
 */
import { z } from "zod";

import {
  entry,
  isoTime,
  pageInput,
  staffAccessPageSchema,
  type StaffAccessFunctionEntry,
} from "./staff-access-function-shapes.ts";

const staffAccessMemberRoleSchema = z.enum(["admin", "member", "external", "developer", "other"]);
const staffAccessInviteStateSchema = z.enum([
  "pending",
  "accepted",
  "expired",
  "revoked",
  "waiting_approval",
  "payment_pending",
  "other",
]);

export const STAFF_ACCESS_PEOPLE_FUNCTIONS = {
  "org.invites": entry({
    title: "Invitations in every state, with role, teams and who accepted",
    scope: "org",
    answers:
      "Why an invitation did not land: expired, revoked, waiting on a checkout, or accepted.",
    input: z.object({ state: staffAccessInviteStateSchema.optional(), ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          inviteId: z.string(),
          role: staffAccessMemberRoleSchema,
          state: staffAccessInviteStateSchema,
          billingOnly: z.boolean(),
          /** Held for a seat checkout until it is paid. */
          viaCheckout: z.boolean(),
          teamIds: z.array(z.string()),
          requestedByUserId: z.string().nullable(),
          acceptedByUserId: z.string().nullable(),
          createdAt: isoTime,
          updatedAt: isoTime,
          expiresAt: isoTime.nullable(),
        })
        .strict(),
    ),
  }),
  "users.find": entry({
    title: "The account behind one exact email, and the organizations it belongs to",
    scope: "lookup",
    personal: true,
    answers: "Whether an invitee already has an account, and which organizations it is in.",
    input: z.object({ email: z.email().max(320) }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          userId: z.string(),
          createdAt: isoTime,
          deactivated: z.boolean(),
          /** Organizations it is an active member of. */
          orgIds: z.array(z.string()),
          /** Organizations whose membership is switched off. */
          disabledOrgIds: z.array(z.string()),
        })
        .strict(),
    ),
  }),
  "org.members": entry({
    title: "Members with role, how they joined, last sign-in and switched-off state",
    scope: "org",
    answers: "Who is in the organization, whether they still sign in, and who is switched off.",
    input: z.object({ ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          userId: z.string(),
          role: staffAccessMemberRoleSchema,
          /** An invitation brought them; false covers sign-on, domain and directory joins. */
          invited: z.boolean(),
          joinedAt: isoTime,
          disabledAt: isoTime.nullable(),
          lastSignInAt: isoTime.nullable(),
          /** The account itself is retired, in every organization. */
          deactivated: z.boolean(),
        })
        .strict(),
    ),
  }),
  "orgs.seat_overage": entry({
    title: "Organizations holding more full or Lite seats than their plan sells",
    scope: "platform",
    answers: "Which organizations are over their seat cap, by how much, and on which plan.",
    input: z.object({ ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          organizationId: z.string(),
          plan: z.string(),
          fullSeatCap: z.number().int().nullable(),
          fullSeatsUsed: z.number().int(),
          liteSeatCap: z.number().int().nullable(),
          liteSeatsUsed: z.number().int(),
          /** Seats over the caps, full and Lite added up. */
          overBy: z.number().int(),
          /** When a lapse to Free left it over plan; null otherwise. */
          overPlanSince: isoTime.nullable(),
        })
        .strict(),
    ),
  }),
} as const satisfies Record<string, StaffAccessFunctionEntry>;
