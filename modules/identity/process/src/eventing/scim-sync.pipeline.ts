import {
  defineAggregate,
  definePipeline,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
  defineEventingModule,
  type EventingSetup,
} from "@langwatch/eventing";
import { SCIM_SYNC_AGGREGATE_TYPE, SCIM_SYNC_PIPELINE_NAME } from "@langwatch/identity-contract";

import type { IdentityApp } from "../app/identity.app.ts";
import type { IdentityRepositories } from "../repositories/identity.repositories.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import {
  type ScimSyncEvent,
  type ScimSyncFoldState,
  ScimSyncStateFoldProjection,
  scimTokenIssuedEventSchema,
  scimUserPushedEventSchema,
  scimGroupMappedEventSchema,
  scimApplyFailedEventSchema,
  scimApplyRecoveredEventSchema,
  scimApplyRetiredEventSchema,
  scimApplyRedrivenEventSchema,
  scimTokenRevokedEventSchema,
} from "./scim-sync-state.projection.ts";
import {
  IssueScimTokenCommand,
  RecordScimApplyFailureCommand,
  RecordScimGroupMappingCommand,
  RecordScimUserPushCommand,
  RedriveScimApplyCommand,
  RevokeScimSyncCommand,
} from "./scim-sync.intent.ts";

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
export type ScimSyncPipeline = StaticPipelineDefinition<
  ScimSyncEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

export function defineScimSyncPipeline(deps: ScimSyncPipelineDeps): ScimSyncPipeline {
  const builder = definePipeline({
    name: SCIM_SYNC_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: SCIM_SYNC_AGGREGATE_TYPE,
    }),
  })
    .withEvents([
      scimTokenIssuedEventSchema,
      scimUserPushedEventSchema,
      scimGroupMappedEventSchema,
      scimApplyFailedEventSchema,
      scimApplyRecoveredEventSchema,
      scimApplyRetiredEventSchema,
      scimApplyRedrivenEventSchema,
      scimTokenRevokedEventSchema,
    ])
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

/** The directory-sync pipeline over its ONE row, in both roles. */
export function composeScimSyncPipeline(
  repositories: Pick<IdentityRepositories, "scimSyncs">,
): ScimSyncPipeline {
  return defineScimSyncPipeline({
    scimSyncProjectionStore: repositories.scimSyncs,
    scimSyncGuards: ScimSyncGuardsService.create({ syncs: repositories.scimSyncs }),
  });
}

export const scimSyncEventing = defineEventingModule({
  pipeline: SCIM_SYNC_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<IdentityRepositories, IdentityApp>) =>
    app.scimSyncPipeline({ participation }),
  connect: ({ app, commands }) =>
    app.connectPipeline({ pipeline: SCIM_SYNC_PIPELINE_NAME, commands }),
});
