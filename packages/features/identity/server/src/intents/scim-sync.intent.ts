import {
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  issueScimTokenCommandDataSchema,
  RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE,
  RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  REVOKE_SCIM_SYNC_COMMAND_TYPE,
  recordScimApplyFailureCommandDataSchema,
  recordScimGroupMappingCommandDataSchema,
  recordScimUserPushCommandDataSchema,
  revokeScimSyncCommandDataSchema,
  type ScimSyncCommand,
} from "@langwatch/identity-contract";
import type { ScimSyncGuards } from "../scim-sync-guards";
import type { ZodTypeAny, z } from "zod";
import {
  type Command,
  type CommandHandler,
  defineCommandSchema,
} from "@langwatch/eventing";
import { scimSyncEventsFor } from "../projections/scim-sync-state.projection";
import type { ScimSyncEvent } from "../projections/scim-sync-state.projection";

/**
 * The directory-sync pipeline's five verbs, as the queue's STAGED RE-RUN of
 * each: the same guard the calling path ran, the same envelope. A retried
 * command carries the same commandId, so the re-run costs no second event.
 *
 * Every one is the identical move, so it is written once here rather than
 * five times across five files — the connection pipeline's
 * `ssoConnectionCommands.ts` shape, for the same reason.
 */

type GuardVerb = {
  [K in keyof ScimSyncGuards]: ScimSyncGuards[K] extends (
    data: never,
  ) => Promise<unknown>
    ? K
    : never;
}[keyof ScimSyncGuards];

function scimSyncCommand<Schema extends ZodTypeAny>({
  type,
  schema,
  description,
  verb,
}: {
  type: ScimSyncCommand["type"];
  schema: Schema;
  description: string;
  verb: GuardVerb;
}) {
  type Data = z.infer<Schema>;
  return class ScimSyncCommandHandler
    implements CommandHandler<Command<Data>, ScimSyncEvent>
  {
    static readonly schema = defineCommandSchema(type, schema, description);

    /** The SYNC is the aggregate — never the organization. One connection's
     *  pushes share a lane; two connections never do, so a directory that
     *  falls over cannot hold up the one beside it. */
    static getAggregateId(payload: { scimSyncId: string }): string {
      return payload.scimSyncId;
    }

    constructor(private readonly guards: ScimSyncGuards) {}

    async handle(command: Command<Data>): Promise<ScimSyncEvent[]> {
      const data = command.data as never;
      const facts = await (
        this.guards[verb] as (input: never) => Promise<never[]>
      )(data);
      return scimSyncEventsFor({
        command: { type, data } as ScimSyncCommand,
        facts,
      });
    }
  };
}

export const IssueScimTokenCommand = scimSyncCommand({
  type: ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  schema: issueScimTokenCommandDataSchema,
  description: "Start a connection's directory sync when its token is minted",
  verb: "issueScimToken",
});

export const RecordScimUserPushCommand = scimSyncCommand({
  type: RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  schema: recordScimUserPushCommandDataSchema,
  description: "Record what a directory push did to one person",
  verb: "recordScimUserPush",
});

export const RecordScimGroupMappingCommand = scimSyncCommand({
  type: RECORD_SCIM_GROUP_MAPPING_COMMAND_TYPE,
  schema: recordScimGroupMappingCommandDataSchema,
  description: "Record a directory group arriving from a connection",
  verb: "recordScimGroupMapping",
});

export const RecordScimApplyFailureCommand = scimSyncCommand({
  type: RECORD_SCIM_APPLY_FAILURE_COMMAND_TYPE,
  schema: recordScimApplyFailureCommandDataSchema,
  description:
    "Record a directory apply that failed, and retire it if it never can succeed",
  verb: "recordScimApplyFailure",
});

export const RevokeScimSyncCommand = scimSyncCommand({
  type: REVOKE_SCIM_SYNC_COMMAND_TYPE,
  schema: revokeScimSyncCommandDataSchema,
  description: "End a connection's directory sync on revoke or teardown",
  verb: "revokeScimSync",
});
