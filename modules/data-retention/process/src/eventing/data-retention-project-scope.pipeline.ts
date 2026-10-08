import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionProjectScopeRepository } from "../repositories/data-retention-project-scope.repository.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import { dataRetentionProjectScopePeerFold } from "./data-retention-project-scope.projection.ts";

/** Hosts retention's peer fold over project's lifecycle facts; it records no event of its own. */
export const DATA_RETENTION_PROJECT_SCOPE_PIPELINE_NAME = "data_retention_project_scope" as const;

function dataRetentionProjectScopeHost(store: DataRetentionProjectScopeRepository) {
  return definePipeline({
    name: DATA_RETENTION_PROJECT_SCOPE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "data_retention_project_scope" }),
  })
    .withEvents([])
    .withPeerFoldProjection(dataRetentionProjectScopePeerFold(store));
}

/** The host pipeline as a TYPE, derived from the builder above. */
export type DataRetentionProjectScopePipeline = ReturnType<
  ReturnType<typeof dataRetentionProjectScopeHost>["build"]
>;

export function buildDataRetentionProjectScopePipeline(
  store: DataRetentionProjectScopeRepository,
): DataRetentionProjectScopePipeline {
  return dataRetentionProjectScopeHost(store).build();
}

export const dataRetentionProjectScopeEventing = defineEventingModule({
  pipeline: DATA_RETENTION_PROJECT_SCOPE_PIPELINE_NAME,
  build: ({ repositories }: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    buildDataRetentionProjectScopePipeline(repositories.projectScopes),
});
