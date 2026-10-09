// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ScimSyncGuards } from "@ee/scim/scim-sync-guards";
import { definePipeline } from "~/server/event-sourcing";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import {
  IssueScimTokenCommand,
  RecordScimApplyFailureCommand,
  RecordScimGroupMappingCommand,
  RecordScimUserPushCommand,
  RedriveScimApplyCommand,
  RevokeScimSyncCommand,
} from "./commands/scimSyncCommands";
import {
  runScimRequestLogRetention,
  SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS,
  SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
  type ScimRequestLogRetentionDeps,
  type ScimRequestLogRetentionState,
  scimRequestLogRetentionSchema,
  scimRequestLogRetentionWake,
} from "./process-manager/scim-request-log-retention-sweep.process";
import {
  SCIM_SYNC_PROJECTION_NAME,
  type ScimSyncFoldState,
  ScimSyncStateFoldProjection,
} from "./projections/scimSyncState.foldProjection";
import {
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_PIPELINE_NAME,
} from "./schemas/constants";
import type { ScimSyncEvent } from "./schemas/events";

/**
 * Every verb the aggregate has, and the name its queue sender is resolved by
 * (the ledger writer maps a command type to one of these strings).
 */
const SCIM_SYNC_COMMANDS = [
  ["issueScimToken", IssueScimTokenCommand],
  ["recordScimUserPush", RecordScimUserPushCommand],
  ["recordScimGroupMapping", RecordScimGroupMappingCommand],
  ["recordScimApplyFailure", RecordScimApplyFailureCommand],
  ["redriveScimApply", RedriveScimApplyCommand],
  ["revokeScimSync", RevokeScimSyncCommand],
] as const;

export interface ScimSyncPipelineDeps {
  scimSyncProjectionStore: StateProjectionStore<ScimSyncFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-server`'s
   *  ScimSyncGuards over the app's projection reads, the same instance shape
   *  the calling path uses. */
  scimSyncGuards: ScimSyncGuards;
  /** Periodic deletion of SCIM request records past their retention window. */
  logRetention: ScimRequestLogRetentionDeps;
}

/**
 * The directory-sync pipeline (D08). One aggregate per connection's sync; the
 * organization is the tenant. Commands append (waited) and the operational
 * projection folds into the Postgres `ScimSyncState` head in per-sync FIFO.
 *
 * The SCIM aggregate has no apply process manager, deliberately. A SCIM push
 * is a synchronous request an identity provider makes and retries on its own
 * schedule, so the retry this aggregate records is the DIRECTORY's, not one
 * of ours: a push that lands states its own recovery, and a failure that will
 * never succeed is retired by the guard into a dead letter the projection
 * keeps. Adding a queue that re-attempted the apply behind the provider's back
 * would mean two things pushing the same state and neither able to say which
 * one the customer is looking at. The separate request-log retention process
 * below only deletes operational evidence after its retention window.
 *
 * ONE VERB IS NOT THE DIRECTORY'S. `redriveScimApply` is a platform operator
 * sending a retired apply through again once its cause is fixed (ADR-122) —
 * the single write either reconciliation surface has. It is still not a
 * queue re-attempting anything behind the provider's back: a person decided,
 * and the fact carries which person.
 *
 * Ships DARK: `SCIM_V2_GRANTS` defaults off, so no SCIM request path
 * dispatches these commands and the previous write path is unchanged. A
 * deploy changes nothing on its own.
 *
 * Lanes: the commands keep the default per-aggregate group key — one
 * connection's sync is one lane, so a directory that starts failing cannot
 * hold up the connection beside it.
 */
export function createScimSyncPipeline(deps: ScimSyncPipelineDeps) {
  let builder = definePipeline<ScimSyncEvent>()
    .withName(SCIM_SYNC_PIPELINE_NAME)
    .withAggregateType(SCIM_SYNC_AGGREGATE_TYPE)
    .withProjection(
      SCIM_SYNC_PROJECTION_NAME,
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

  return builder
    .withProcessManager(SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME, (pm) =>
      pm
        .state<ScimRequestLogRetentionState>({ lastSweepAt: null })
        .schedule({ everyMs: SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS })
        .onWake(scimRequestLogRetentionWake)
        .intent(
          "sweep",
          scimRequestLogRetentionSchema,
          runScimRequestLogRetention(deps.logRetention),
        )
        .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}
