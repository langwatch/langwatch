import {
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_PIPELINE_NAME,
} from "@langwatch/enterprise-scim-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineAggregate,
  definePipeline,
  type StateProjectionStore,
  defineEventingModule,
  type EventingSetup,
} from "@langwatch/eventing";

import type { ScimModule } from "../app/scim.app.ts";
import type { ScimRepositories } from "../repositories/scim.repositories.ts";
import { ScimSyncGuardsService } from "../services/scim-sync-guards.service.ts";
import {
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

interface ScimSyncPipelineDeps {
  scimSyncProjectionStore: StateProjectionStore<ScimSyncFoldState>;
  /** The guards every command handler runs, over the same head the calling path reads. */
  scimSyncGuards: ScimSyncGuardsService;
}

/**
 * The directory-sync pipeline (D08). One aggregate per connection's sync; the organization is the
 * tenant. Commands append (waited) and the operational projection folds into the Postgres
 * `ScimSyncState` head in per-sync FIFO. NO PROCESS MANAGER, deliberately.
 */
function scimSyncCommands(deps: ScimSyncPipelineDeps) {
  return definePipeline({
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
    .withCommandInstance({
      name: "issueScimToken",
      handlerClass: IssueScimTokenCommand,
      instance: new IssueScimTokenCommand(deps.scimSyncGuards),
    })
    .withCommandInstance({
      name: "recordScimUserPush",
      handlerClass: RecordScimUserPushCommand,
      instance: new RecordScimUserPushCommand(deps.scimSyncGuards),
    })
    .withCommandInstance({
      name: "recordScimGroupMapping",
      handlerClass: RecordScimGroupMappingCommand,
      instance: new RecordScimGroupMappingCommand(deps.scimSyncGuards),
    })
    .withCommandInstance({
      name: "recordScimApplyFailure",
      handlerClass: RecordScimApplyFailureCommand,
      instance: new RecordScimApplyFailureCommand(deps.scimSyncGuards),
    })
    .withCommandInstance({
      name: "redriveScimApply",
      handlerClass: RedriveScimApplyCommand,
      instance: new RedriveScimApplyCommand(deps.scimSyncGuards),
    })
    .withCommandInstance({
      name: "revokeScimSync",
      handlerClass: RevokeScimSyncCommand,
      instance: new RevokeScimSyncCommand(deps.scimSyncGuards),
    });
}

/** The directory-sync pipeline as a TYPE, derived from the builder above. */
export type ScimSyncPipeline = ReturnType<ReturnType<typeof scimSyncCommands>["build"]>;

export function defineScimSyncPipeline(deps: ScimSyncPipelineDeps): ScimSyncPipeline {
  return scimSyncCommands(deps).build();
}

/** The directory-sync pipeline over its ONE row, in both roles. */
export function composeScimSyncPipeline(
  repositories: Pick<ScimRepositories, "scimSyncs">,
): ScimSyncPipeline {
  return defineScimSyncPipeline({
    scimSyncProjectionStore: repositories.scimSyncs,
    scimSyncGuards: ScimSyncGuardsService.create({ syncs: repositories.scimSyncs }),
  });
}

export const scimSyncEventing = defineEventingModule({
  pipeline: SCIM_SYNC_PIPELINE_NAME,
  build: ({ repositories }: EventingSetup<ScimRepositories, ScimModule>) =>
    composeScimSyncPipeline(repositories),
  connect: ({ app, commands }) => app.connectScimSync(commands),
});
