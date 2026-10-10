import type { Named } from "@langwatch/module";
/** Contract schemas for the `identity.joinRequests.*` responses, in identity's own vocabulary. */
import { z } from "zod";

import { DOMAIN_JOIN_SETTINGS, JOINER_ROLES } from "./join-matching.ts";

const domainJoinSettingSchema = z.enum(DOMAIN_JOIN_SETTINGS);
/** The seat a joiner without an invitation lands on (ADR-171). */
export const joinerRoleSchema = z.enum(JOINER_ROLES);

/** One request this caller, or this organization's admins, are waiting on. */
const waitingSinceSchema = z
  .object({
    joinRequestId: z.string().min(1),
    requestedAt: z.date(),
    expiresAt: z.date().nullable(),
  })
  .strict();

/** Everything this person has asked to join and not yet heard back on. */
const joinRequestMineSchemaDefinition = waitingSinceSchema
  .safeExtend({ organizationId: z.string().min(1) })
  .array();
export interface JoinRequestMineSchema extends Named<typeof joinRequestMineSchemaDefinition> {}
export const joinRequestMineSchema: JoinRequestMineSchema = joinRequestMineSchemaDefinition;
export type JoinRequestMine = z.infer<typeof joinRequestMineSchema>;

/** A request was filed; whether it needs an admin or was granted outright. */
const joinRequestFiledSchemaDefinition = z
  .object({ joinRequestId: z.string().min(1), state: z.enum(["PENDING", "APPROVED"]) })
  .strict();
export interface JoinRequestFiledSchema extends Named<typeof joinRequestFiledSchemaDefinition> {}
export const joinRequestFiledSchema: JoinRequestFiledSchema = joinRequestFiledSchemaDefinition;
export type JoinRequestFiled = z.infer<typeof joinRequestFiledSchema>;

/**
 * The organization somebody was just admitted to by its domain setting, or
 * null when nothing admits their address: the ordinary case, not a failure.
 */
const joinRequestAdmittedSchemaDefinition = z
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
export interface JoinRequestAdmittedSchema extends Named<
  typeof joinRequestAdmittedSchemaDefinition
> {}
export const joinRequestAdmittedSchema: JoinRequestAdmittedSchema =
  joinRequestAdmittedSchemaDefinition;
export type JoinRequestAdmitted = z.infer<typeof joinRequestAdmittedSchema>;

/** Who walked in on the domain setting lately, named for the members area. */
const joinRequestAutomaticJoinsSchemaDefinition = z
  .object({
    joinRequestId: z.string().min(1),
    userId: z.string().min(1),
    name: z.string(),
    domain: z.string(),
    joinedAt: z.date().nullable(),
  })
  .strict()
  .array();
export interface JoinRequestAutomaticJoinsSchema extends Named<
  typeof joinRequestAutomaticJoinsSchemaDefinition
> {}
export const joinRequestAutomaticJoinsSchema: JoinRequestAutomaticJoinsSchema =
  joinRequestAutomaticJoinsSchemaDefinition;
export type JoinRequestAutomaticJoins = z.infer<typeof joinRequestAutomaticJoinsSchema>;

/** A write with nothing else to report. */
const joinRequestWriteAckSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface JoinRequestWriteAckSchema extends Named<
  typeof joinRequestWriteAckSchemaDefinition
> {}
export const joinRequestWriteAckSchema: JoinRequestWriteAckSchema =
  joinRequestWriteAckSchemaDefinition;
export type JoinRequestWriteAck = z.infer<typeof joinRequestWriteAckSchema>;

/** One request waiting on this organization's admins, named for the reviewer. */
const joinRequestPendingSchemaDefinition = waitingSinceSchema
  .safeExtend({
    userId: z.string().min(1),
    name: z.string(),
    domain: z.string(),
    /** The seat approval lands (ADR-171 v6): read only, approval carries no role. */
    seat: joinerRoleSchema,
  })
  .array();
export interface JoinRequestPendingSchema extends Named<
  typeof joinRequestPendingSchemaDefinition
> {}
export const joinRequestPendingSchema: JoinRequestPendingSchema =
  joinRequestPendingSchemaDefinition;
export type JoinRequestPending = z.infer<typeof joinRequestPendingSchema>;

/** How colleagues on a matching domain currently get into this organization. */
const joinRequestJoiningSchemaDefinition = z
  .object({
    domainJoin: domainJoinSettingSchema,
    joinDomains: z.array(z.string()),
    joinerRole: joinerRoleSchema,
  })
  .strict();
export interface JoinRequestJoiningSchema extends Named<
  typeof joinRequestJoiningSchemaDefinition
> {}
export const joinRequestJoiningSchema: JoinRequestJoiningSchema =
  joinRequestJoiningSchemaDefinition;
export type JoinRequestJoining = z.infer<typeof joinRequestJoiningSchema>;

/** The setting changed; both values and both domain lists, as the audit row records them. */
const joinRequestJoiningChangedSchemaDefinition = z
  .object({
    previous: domainJoinSettingSchema,
    next: domainJoinSettingSchema,
    previousDomains: z.array(z.string()),
    nextDomains: z.array(z.string()),
    previousJoinerRole: joinerRoleSchema,
    nextJoinerRole: joinerRoleSchema,
  })
  .strict();
export interface JoinRequestJoiningChangedSchema extends Named<
  typeof joinRequestJoiningChangedSchemaDefinition
> {}
export const joinRequestJoiningChangedSchema: JoinRequestJoiningChangedSchema =
  joinRequestJoiningChangedSchemaDefinition;
export type JoinRequestJoiningChanged = z.infer<typeof joinRequestJoiningChangedSchema>;

/** A member a matching domain admitted, and whether the policy did it with nobody approving. */
const identityDomainAdmissionSchemaDefinition = z.object({
  userId: z.string(),
  domain: z.string(),
  automatic: z.boolean(),
  /** Set when single sign-on admitted them on arrival, naming the connection. */
  connectionId: z.string().nullable(),
});
export interface IdentityDomainAdmissionSchema extends Named<
  typeof identityDomainAdmissionSchemaDefinition
> {}
export const identityDomainAdmissionSchema: IdentityDomainAdmissionSchema =
  identityDomainAdmissionSchemaDefinition;
