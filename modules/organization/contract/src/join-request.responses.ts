/**
 * What the join-request feature's tRPC transport answers, stated once.
 *
 * The chain declares each procedure's `withOutput` from here, so the shape a
 * client reads is written down in the contract rather than implied by
 * whatever a handler happened to return. The schemas are checked against
 * real answers in development and test; production returns the handler's
 * own value.
 */
import { z } from "zod";

/**
 * The identity feature's own three settings, inlined rather than imported:
 * this package does not otherwise depend on `@langwatch/identity-contract`,
 * and adding that dependency mid-migration would touch the shared lockfile
 * while other lanes are editing it concurrently. Keep this in step with
 * `DOMAIN_JOIN_SETTINGS` in
 * `modules/identity/contract/src/join-matching.ts`.
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
  .extend({ organizationId: z.string().min(1) })
  .array();
export type JoinRequestMine = z.infer<typeof joinRequestMineSchema>;

/** A request was filed; whether it needs an admin or was granted outright. */
export const joinRequestFiledSchema = z
  .object({ joinRequestId: z.string().min(1), state: z.enum(["PENDING", "APPROVED"]) })
  .strict();
export type JoinRequestFiled = z.infer<typeof joinRequestFiledSchema>;

/** A write with nothing else to report. */
export const joinRequestWriteAckSchema = z.object({ success: z.literal(true) }).strict();
export type JoinRequestWriteAck = z.infer<typeof joinRequestWriteAckSchema>;

/** One request waiting on this organization's admins, named for the reviewer. */
export const joinRequestPendingSchema = waitingSinceSchema
  .extend({
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

/** The setting changed; the caller reads back what it was and what it is now. */
export const joinRequestJoiningChangedSchema = z
  .object({ previous: domainJoinSettingSchema, next: domainJoinSettingSchema })
  .strict();
export type JoinRequestJoiningChanged = z.infer<typeof joinRequestJoiningChangedSchema>;
