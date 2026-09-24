import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  SCIM_SYNC_EVENT_TYPES,
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_PIPELINE_NAME,
} from "@langwatch/identity-contract";

import {
  type ScimSyncEvent,
  type ScimSyncFoldState,
  ScimSyncStateFoldProjection,
} from "../eventing/scim-sync-state.projection.ts";
import {
  IssueScimTokenCommand,
  RecordScimApplyFailureCommand,
  RecordScimGroupMappingCommand,
  RecordScimUserPushCommand,
  RedriveScimApplyCommand,
  RevokeScimSyncCommand,
} from "../eventing/scim-sync.intent.ts";
import type { ScimSyncGuardsService } from "./scim-sync-guards.service.ts";

export interface ScimSyncPipelineDeps {
  scimSyncProjectionStore: StateProjectionStore<ScimSyncFoldState>;
  /** The guards every command handler runs — `@langwatch/identity-process`'s
   *  ScimSyncGuardsService over the app's projection reads, the same instance shape
   *  the calling path uses. */
  scimSyncGuards: ScimSyncGuardsService;
}

/**
 * The directory-sync pipeline (D08). One aggregate per connection's sync; the organization is the
 * tenant. Commands append (waited) and the operational projection folds into the Postgres
 * `ScimSyncState` head in per-sync FIFO. NO PROCESS MANAGER, deliberately.
/** The directory-sync pipeline as a TYPE, derived from the builder below. */
export type ScimSyncPipeline = ReturnType<typeof ScimSyncPipelineDefinitionAdapter.create>;

export class ScimSyncPipelineDefinitionAdapter {
  static create(
    deps: ScimSyncPipelineDeps,
  ): StaticPipelineDefinition<ScimSyncEvent, Record<string, Projection>, RegisteredCommand> {
    const builder = definePipeline<ScimSyncEvent>({
      name: SCIM_SYNC_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: SCIM_SYNC_AGGREGATE_TYPE,
        events: defineEvents(SCIM_SYNC_EVENT_TYPES),
      }),
    })
      .withPostgresProjection(
        new ScimSyncStateFoldProjection({
          store: deps.scimSyncProjectionStore,
        }),
      )
      .withCommandInstance(
        "issueScimToken",
        IssueScimTokenCommand,
        new IssueScimTokenCommand(deps.scimSyncGuards),
      )
      .withCommandInstance(
        "recordScimUserPush",
        RecordScimUserPushCommand,
        new RecordScimUserPushCommand(deps.scimSyncGuards),
      )
      .withCommandInstance(
        "recordScimGroupMapping",
        RecordScimGroupMappingCommand,
        new RecordScimGroupMappingCommand(deps.scimSyncGuards),
      )
      .withCommandInstance(
        "recordScimApplyFailure",
        RecordScimApplyFailureCommand,
        new RecordScimApplyFailureCommand(deps.scimSyncGuards),
      )
      .withCommandInstance(
        "redriveScimApply",
        RedriveScimApplyCommand,
        new RedriveScimApplyCommand(deps.scimSyncGuards),
      )
      .withCommandInstance(
        "revokeScimSync",
        RevokeScimSyncCommand,
        new RevokeScimSyncCommand(deps.scimSyncGuards),
      );

    return builder.build();
  }
}
