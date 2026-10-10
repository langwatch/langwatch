import { ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Directory sync commands: issue token, record pushes and failures, revoke sync. Each carries a
 * caller-minted commandId for deduplication. No PII; persons are userId + externalId. See D08.
 */
import { z } from "zod";

import { scimApplyOpSchema, scimRevokeCauseSchema, scimUserOpSchema } from "./scim-sync.ts";

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
  actor: ledgerActorSchema,
});

/**
 * Every sync command enforces `tenantId === organizationId`. Wiring them
 * differently would fold events into another organization's projection
 * undetectably downstream — refused at the wire boundary.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodType<
  z.output<z.ZodObject<z.core.util.Writeable<typeof commandIdentitySchema.shape & Shape>>>
> {
  return z.object({ ...commandIdentitySchema.shape, ...shape }).refine(
    (data) => {
      // zod 4 widens the spread object's output under a generic shape to a union that
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

const issueScimTokenCommandDataSchemaDefinition = commandDataSchema({
  tokenId: z.string().min(1),
});
export interface IssueScimTokenCommandDataSchema extends Named<
  typeof issueScimTokenCommandDataSchemaDefinition
> {}
export const issueScimTokenCommandDataSchema: IssueScimTokenCommandDataSchema =
  issueScimTokenCommandDataSchemaDefinition;
export type IssueScimTokenCommandData = z.infer<typeof issueScimTokenCommandDataSchema>;

const recordScimUserPushCommandDataSchemaDefinition = commandDataSchema({
  userId: z.string().min(1),
  externalId: z.string().min(1),
  op: scimUserOpSchema,
});
export interface RecordScimUserPushCommandDataSchema extends Named<
  typeof recordScimUserPushCommandDataSchemaDefinition
> {}
export const recordScimUserPushCommandDataSchema: RecordScimUserPushCommandDataSchema =
  recordScimUserPushCommandDataSchemaDefinition;
export type RecordScimUserPushCommandData = z.infer<typeof recordScimUserPushCommandDataSchema>;

const recordScimGroupMappingCommandDataSchemaDefinition = commandDataSchema({
  groupId: z.string().min(1),
  externalId: z.string().min(1).nullable(),
});
export interface RecordScimGroupMappingCommandDataSchema extends Named<
  typeof recordScimGroupMappingCommandDataSchemaDefinition
> {}
export const recordScimGroupMappingCommandDataSchema: RecordScimGroupMappingCommandDataSchema =
  recordScimGroupMappingCommandDataSchemaDefinition;
export type RecordScimGroupMappingCommandData = z.infer<
  typeof recordScimGroupMappingCommandDataSchema
>;

const recordScimApplyFailureCommandDataSchemaDefinition = commandDataSchema({
  op: scimApplyOpSchema,
  /** A stable slug, never a provider's prose: this reaches a customer's
   *  failure surface, and prose is where a hostname arrives from. */
  errorCode: z.string().min(1),
  retryable: z.boolean(),
  userId: z.string().min(1).nullable(),
});
export interface RecordScimApplyFailureCommandDataSchema extends Named<
  typeof recordScimApplyFailureCommandDataSchemaDefinition
> {}
export const recordScimApplyFailureCommandDataSchema: RecordScimApplyFailureCommandDataSchema =
  recordScimApplyFailureCommandDataSchemaDefinition;
export type RecordScimApplyFailureCommandData = z.infer<
  typeof recordScimApplyFailureCommandDataSchema
>;

/**
 * Send a retired apply through again (ADR-122): the one verb an operator
 * issues rather than a directory. `retiredAtMs` names which dead letter.
 */
const redriveScimApplyCommandDataSchemaDefinition = commandDataSchema({
  retiredAtMs: z.number().int().nonnegative(),
});
export interface RedriveScimApplyCommandDataSchema extends Named<
  typeof redriveScimApplyCommandDataSchemaDefinition
> {}
export const redriveScimApplyCommandDataSchema: RedriveScimApplyCommandDataSchema =
  redriveScimApplyCommandDataSchemaDefinition;
export type RedriveScimApplyCommandData = z.infer<typeof redriveScimApplyCommandDataSchema>;

const revokeScimSyncCommandDataSchemaDefinition = commandDataSchema({
  tokenId: z.string().min(1).nullable(),
  cause: scimRevokeCauseSchema,
});
export interface RevokeScimSyncCommandDataSchema extends Named<
  typeof revokeScimSyncCommandDataSchemaDefinition
> {}
export const revokeScimSyncCommandDataSchema: RevokeScimSyncCommandDataSchema =
  revokeScimSyncCommandDataSchemaDefinition;
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
