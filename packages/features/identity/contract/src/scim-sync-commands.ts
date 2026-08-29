/**
 * The directory sync commands (D08). Every way a connection's sync history
 * changes, and no other: minting its token, recording what a push did,
 * recording that an apply failed, and ending it.
 *
 * Each command carries a caller-minted `commandId`, so a retried command
 * dedupes at the event store (`<commandId>:<index>`) while a legitimately
 * repeated push — which a directory makes every night — never can, because
 * it mints a fresh id.
 *
 * No PII rides here, for the same reason it does not ride on the facts: a
 * person is a `userId` and the directory's `externalId`, and a credential
 * appears as a token ROW id or not at all.
 *
 * See specs/identity/scim-connection-sync.feature.
 */
import { z } from "zod";
import {
  scimApplyOpSchema,
  scimRevokeCauseSchema,
  scimUserOpSchema,
} from "./scim-sync";
import { identityActorSchema } from "./vocabulary";

export const ISSUE_SCIM_TOKEN_COMMAND_TYPE =
  "lw.identity.issue_scim_token" as const;
export const RECORD_SCIM_USER_PUSH_COMMAND_TYPE =
  "lw.identity.record_scim_user_push" as const;
export const RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE =
  "lw.identity.record_scim_group_mapping" as const;
export const RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE =
  "lw.identity.record_scim_apply_failure" as const;
export const REVOKE_SCIM_SYNC_COMMAND_TYPE =
  "lw.identity.revoke_scim_sync" as const;

export const SCIM_SYNC_COMMAND_TYPES = [
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE,
  RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE,
  REVOKE_SCIM_SYNC_COMMAND_TYPE,
] as const;
export type ScimSyncCommandType = (typeof SCIM_SYNC_COMMAND_TYPES)[number];

const commandIdentitySchema = z.object({
  /** The ORGANIZATION is the tenant of its syncs' history, exactly as it is
   *  for its connections: support reads both in one tenant scan. */
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The aggregate. One connection's sync, one history, one lane. */
  scimSyncId: z.string().min(1),
  /** Which connection pushed. Carried on every command because this - not
   *  the actor stamp - is where "which directory did this" is recorded. */
  connectionId: z.string().min(1),
  commandId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});

/**
 * Every sync command carries the identity block AND the invariant that makes
 * it one history per organization: `tenantId === organizationId`. A caller
 * wiring them differently would persist events under one tenant's stream and
 * fold them into another organization's projection, which nothing downstream
 * can detect. Refused at the wire boundary instead.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return commandIdentitySchema
    .extend(shape)
    .refine((data) => data.tenantId === data.organizationId, {
      message:
        "tenantId must equal organizationId: one directory-sync history per organization",
      path: ["tenantId"],
    });
}

export const issueScimTokenCommandDataSchema = commandDataSchema({
  tokenId: z.string().min(1),
});
export type IssueScimTokenCommandData = z.infer<
  typeof issueScimTokenCommandDataSchema
>;

export const recordScimUserPushCommandDataSchema = commandDataSchema({
  userId: z.string().min(1),
  externalId: z.string().min(1),
  op: scimUserOpSchema,
});
export type RecordScimUserPushCommandData = z.infer<
  typeof recordScimUserPushCommandDataSchema
>;

export const recordScimGroupMappingCommandDataSchema = commandDataSchema({
  groupId: z.string().min(1),
  externalId: z.string().min(1).nullable(),
});
export type RecordScimGroupMappingCommandData = z.infer<
  typeof recordScimGroupMappingCommandDataSchema
>;

export const recordScimApplyFailureCommandDataSchema = commandDataSchema({
  op: scimApplyOpSchema,
  /** A stable slug, never a provider's prose: this reaches a customer's
   *  failure surface, and prose is where a hostname arrives from. */
  errorCode: z.string().min(1),
  retryable: z.boolean(),
  userId: z.string().min(1).nullable(),
});
export type RecordScimApplyFailureCommandData = z.infer<
  typeof recordScimApplyFailureCommandDataSchema
>;

export const revokeScimSyncCommandDataSchema = commandDataSchema({
  tokenId: z.string().min(1).nullable(),
  cause: scimRevokeCauseSchema,
});
export type RevokeScimSyncCommandData = z.infer<
  typeof revokeScimSyncCommandDataSchema
>;

export type ScimSyncCommand =
  | { type: typeof ISSUE_SCIM_TOKEN_COMMAND_TYPE; data: IssueScimTokenCommandData }
  | {
      type: typeof RECORD_SCIM_USER_PUSH_COMMAND_TYPE;
      data: RecordScimUserPushCommandData;
    }
  | {
      type: typeof RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE;
      data: RecordScimGroupMappingCommandData;
    }
  | {
      type: typeof RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE;
      data: RecordScimApplyFailureCommandData;
    }
  | {
      type: typeof REVOKE_SCIM_SYNC_COMMAND_TYPE;
      data: RevokeScimSyncCommandData;
    };
