// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { NurturingModule } from "../app/nurturing.app.ts";
import {
  ORGANIZATION_USAGE_PROCESS_NAME,
  type OrganizationUsageRunDeps,
  organizationUsagePM,
} from "./nurturing-organization-usage.process.ts";

const ORGANIZATION_USAGE_PIPELINE_NAME = "nurturing_organization_usage";

/**
 * The daily Customer.io usage sync, a scheduled process with no events of its own. `global`, like
 * the ops usage report: the sync spans every organization by design.
 */
export function buildOrganizationUsagePipeline(
  deps: OrganizationUsageRunDeps,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: ORGANIZATION_USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(ORGANIZATION_USAGE_PROCESS_NAME, organizationUsagePM(deps))
    .build();
}

export const organizationUsageEventing = defineEventingModule({
  pipeline: ORGANIZATION_USAGE_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<never, NurturingModule>) =>
    buildOrganizationUsagePipeline({
      sync: (input) => app.syncOrganizationUsage(input),
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
      now: () => nowInstant().epochMilliseconds,
    }),
});
