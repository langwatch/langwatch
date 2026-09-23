/** Directory sync commands: issue token, record pushes and failures, revoke sync. Each carries a
 * caller-minted commandId for deduplication. No PII; persons are userId + externalId. See D08.
 */
import { z } from "zod";

import { scimApplyOpSchema, scimRevokeCauseSchema, scimUserOpSchema } from "./scim-sync.ts";
import { identityActorSchema } from "./vocabulary.ts";

export const ISSUE_SCIM_TOKEN_COMMAND_TYPE = "lw.identity.issue_scim_token" as const;
export const RECORD_SCIM_USER_PUSH_COMMAND_TYPE = "lw.identity.record_scim_user_push" as const;
export const RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE =
  "lw.identity.record_scim_group_mapping" as const;
export const RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE =
  "lw.identity.record_scim_apply_failure" as const;
export const REDRIVE_SCIM_APPLY_COMMAND_TYPE = "lw.identity.redrive_scim_apply" as const;
export const REVOKE_SCIM_SYNC_COMMAND_TYPE = "lw.identity.revoke_scim_sync" as const;

export const SCIM_SYNC_COMMAND_TYPES = [
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE,
  RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE,
  REDRIVE_SCIM_APPLY_COMMAND_TYPE,
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
 * Every sync command enforces `tenantId === organizationId`. Wiring them
 * differently would fold events into another organization's projection
 * undetectably downstream — refused at the wire boundary.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodType<z.infer<ReturnType<typeof commandIdentitySchema.extend<Shape>>>> {
  return commandIdentitySchema.extend(shape).refine(
    (data) => {
      // zod 4 widens `.extend()`'s output under a generic shape to a union that
      // no longer names the base's own keys, so the fields this reads are named
      // here rather than inferred. They come from `commandIdentitySchema`, never
      // from `shape`, so they are always present whatever a caller extends with.
      const { tenantId, organizationId } = data as z.infer<typeof commandIdentitySchema>;
      return tenantId === organizationId;
    },
    {
      message: "tenantId must equal organizationId: one directory-sync history per organization",
      path: ["tenantId"],
    },
  );
}

export const issueScimTokenCommandDataSchema = commandDataSchema({
  tokenId: z.string().min(1),
});
export type IssueScimTokenCommandData = z.infer<typeof issueScimTokenCommandDataSchema>;

export const recordScimUserPushCommandDataSchema = commandDataSchema({
  userId: z.string().min(1),
  externalId: z.string().min(1),
  op: scimUserOpSchema,
});
export type RecordScimUserPushCommandData = z.infer<typeof recordScimUserPushCommandDataSchema>;

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

/**
 * Send a retired apply through again (ADR-122): the one verb an operator
 * issues rather than a directory. `retiredAtMs` names which dead letter.
 */
export const redriveScimApplyCommandDataSchema = commandDataSchema({
  retiredAtMs: z.number().int().nonnegative(),
});
export type RedriveScimApplyCommandData = z.infer<typeof redriveScimApplyCommandDataSchema>;

export const revokeScimSyncCommandDataSchema = commandDataSchema({
  tokenId: z.string().min(1).nullable(),
  cause: scimRevokeCauseSchema,
});
export type RevokeScimSyncCommandData = z.infer<typeof revokeScimSyncCommandDataSchema>;

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
      type: typeof REDRIVE_SCIM_APPLY_COMMAND_TYPE;
      data: RedriveScimApplyCommandData;
    }
  | {
      type: typeof REVOKE_SCIM_SYNC_COMMAND_TYPE;
      data: RevokeScimSyncCommandData;
    };
