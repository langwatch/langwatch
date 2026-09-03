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

export {
  type ScimSyncEvent,
  scimSyncEventsFor,
} from "../projections/scim-sync-state.projection";

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
 * The directory-sync pipeline (D08). One aggregate per connection's sync; the
 * organization is the tenant. Commands append (waited) and the operational
 * projection folds into the Postgres `ScimSyncState` head in per-sync FIFO.
 *
 * NO PROCESS MANAGER, deliberately. A SCIM push is a synchronous request an
 * identity provider makes and retries on its own schedule, so the retry this
 * aggregate records is the DIRECTORY's, not one of ours: a push that lands
 * states its own recovery, and a failure that will never succeed is retired
 * by the guard into a dead letter the projection keeps. Adding a queue that
 * re-attempted the apply behind the provider's back would mean two things
 * pushing the same state and neither able to say which one the customer is
 * looking at.
 *
 * Ships DARK: `SCIM_V2_GRANTS` defaults off, so no SCIM request path
 * dispatches these commands and the previous write path is unchanged. A
 * deploy changes nothing on its own.
 *
 * Lanes: the commands keep the default per-aggregate group key — one
 * connection's sync is one lane, so a directory that starts failing cannot
 * hold up the connection beside it.
 */
/** The directory-sync pipeline as a TYPE, derived from the builder below. */
export type ScimSyncPipeline = ReturnType<typeof createScimSyncPipeline>;

export function createScimSyncPipeline(deps: ScimSyncPipelineDeps) {
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
