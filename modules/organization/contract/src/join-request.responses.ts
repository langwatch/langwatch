/** Contract schemas for the join-request feature's tRPC responses. */
import { z } from "zod";

/**
 * The identity feature's own three settings, inlined since this package does
 * not depend on `@langwatch/identity-contract`. Keep in step with
 * `DOMAIN_JOIN_SETTINGS` in `modules/identity/contract/src/join-matching.ts`.
 */
const domainJoinSettingSchema = z.enum(["off", "request", "auto"]);

/** One request this caller, or this organization's admins, are waiting on. */
const waitingSinceSchema = z
  .object({
    joinRequestId: z.string().min(1),
    requestedAt: z.date(),
    expiresAt: z.date().nullable(),
  })
  .strict();

/** Everything this person has asked to join and not yet heard back on. */
export const joinRequestMineSchema = waitingSinceSchema
  .safeExtend({ organizationId: z.string().min(1) })
  .array();
export type JoinRequestMine = z.infer<typeof joinRequestMineSchema>;

/** A request was filed; whether it needs an admin or was granted outright. */
export const joinRequestFiledSchema = z
  .object({ joinRequestId: z.string().min(1), state: z.enum(["PENDING", "APPROVED"]) })
  .strict();
export type JoinRequestFiled = z.infer<typeof joinRequestFiledSchema>;

/**
 * The organization somebody was just admitted to by its domain setting, or
 * null when nothing admits their address — the ordinary case, not a failure.
 * Identity's `JoinOffer`, restated so this contract carries no value import from it.
 */
export const joinRequestAdmittedSchema = z
  .object({
    organization: z
      .object({
        organizationId: z.string().min(1),
        name: z.string(),
        colleagueCount: z.number().int(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type JoinRequestAdmitted = z.infer<typeof joinRequestAdmittedSchema>;

/** Who walked in on the domain setting lately, named for the members area. */
export const joinRequestAutomaticJoinsSchema = z
  .object({
    joinRequestId: z.string().min(1),
    userId: z.string().min(1),
    name: z.string(),
    domain: z.string(),
    joinedAt: z.date().nullable(),
  })
  .strict()
  .array();
export type JoinRequestAutomaticJoins = z.infer<typeof joinRequestAutomaticJoinsSchema>;

/** A write with nothing else to report. */
export const joinRequestWriteAckSchema = z.object({ success: z.literal(true) }).strict();
export type JoinRequestWriteAck = z.infer<typeof joinRequestWriteAckSchema>;

/** One request waiting on this organization's admins, named for the reviewer. */
export const joinRequestPendingSchema = waitingSinceSchema
  .safeExtend({
    userId: z.string().min(1),
    name: z.string(),
    domain: z.string(),
  })
  .array();
export type JoinRequestPending = z.infer<typeof joinRequestPendingSchema>;

/** How colleagues on a matching domain currently get into this organization. */
export const joinRequestJoiningSchema = z
  .object({ domainJoin: domainJoinSettingSchema, joinDomains: z.array(z.string()) })
  .strict();
export type JoinRequestJoining = z.infer<typeof joinRequestJoiningSchema>;

/** The setting changed; both values and both domain lists, as the audit row records them. */
export const joinRequestJoiningChangedSchema = z
  .object({
    previous: domainJoinSettingSchema,
    next: domainJoinSettingSchema,
    previousDomains: z.array(z.string()),
    nextDomains: z.array(z.string()),
  })
  .strict();
export type JoinRequestJoiningChanged = z.infer<typeof joinRequestJoiningChangedSchema>;
