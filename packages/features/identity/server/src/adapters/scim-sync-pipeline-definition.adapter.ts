import type { ScimSyncGuards } from "../scim-sync-guards";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { SCIM_SYNC_EVENT_TYPES } from "@langwatch/identity-contract";
import {
  IssueScimTokenCommand,
  RecordScimApplyFailureCommand,
  RecordScimGroupMappingCommand,
  RecordScimUserPushCommand,
  RevokeScimSyncCommand,
} from "../intents/scim-sync.intent";
import {
  type ScimSyncEvent,
  type ScimSyncFoldState,
  ScimSyncStateFoldProjection,
} from "../projections/scim-sync-state.projection";
import { SCIM_SYNC_AGGREGATE_TYPE, SCIM_SYNC_PIPELINE_NAME } from "@langwatch/identity-contract";

/**
 * Every verb the aggregate has, and the name its queue sender is resolved by
 * (the ledger writer maps a command type to one of these strings).
 */
const SCIM_SYNC_COMMANDS = [
  ["issueScimToken", IssueScimTokenCommand],
  ["recordScimUserPush", RecordScimUserPushCommand],
  ["recordScimGroupMapping", RecordScimGroupMappingCommand],
  ["recordScimApplyFailure", RecordScimApplyFailureCommand],
  ["revokeScimSync", RevokeScimSyncCommand],
] as const;

export interface ScimSyncPipelineDeps {
  scimSyncProjectionStore: StateProjectionStore<ScimSyncFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-server`'s
   *  ScimSyncGuards over the app's projection reads, the same instance shape
   *  the calling path uses. */
  scimSyncGuards: ScimSyncGuards;
}

/**
 * The directory-sync pipeline (D08). One aggregate per connection's sync; the organization is the
 * tenant. Commands append (waited) and the operational projection folds into the Postgres
 * `ScimSyncState` head in per-sync FIFO. NO PROCESS MANAGER, deliberately.
/** The directory-sync pipeline as a TYPE, derived from the builder below. */
export type ScimSyncPipeline = ReturnType<typeof ScimSyncPipelineDefinitionAdapter.create>;

export class ScimSyncPipelineDefinitionAdapter {
  static create(deps: ScimSyncPipelineDeps) {
    let builder = definePipeline<ScimSyncEvent>({
      name: SCIM_SYNC_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: SCIM_SYNC_AGGREGATE_TYPE,
        events: defineEvents(SCIM_SYNC_EVENT_TYPES),
      }),
    }).withPostgresProjection(
      new ScimSyncStateFoldProjection({
        store: deps.scimSyncProjectionStore,
      }),
    );

    for (const [name, Command] of SCIM_SYNC_COMMANDS) {
      // The builder mutates and returns ITSELF; what narrows per call is only
      // its type, and what that type carries is the command-name registry —
      // which nothing downstream reads, because the ledger resolves senders by
      // string. So the loop holds one builder type and the table above stays
      // the readable list of verbs.
      builder = builder.withCommandInstance(
        name,
        Command,
        new Command(deps.scimSyncGuards),
      ) as typeof builder;
    }

    return builder.build();
  }
}
