// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_COST_CENTER_PIPELINE_NAME,
  SCIM_MEMBER_AGGREGATE_TYPE,
} from "@langwatch/enterprise-scim-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { ScimModule } from "../app/scim.app.ts";
import type { ScimRepositories } from "../repositories/scim.repositories.ts";
import { RecordCostCenterChangedCommand } from "./scim-cost-center.commands.ts";
import { scimCostCenterChangedEventSchema } from "./scim-cost-center.events.ts";

/** scim_cost_center: SCIM records each member's cost center; governance assigns the department. */
function buildScimCostCenterPipeline() {
  return definePipeline({
    name: SCIM_COST_CENTER_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SCIM_MEMBER_AGGREGATE_TYPE }),
  })
    .withEvents([scimCostCenterChangedEventSchema])
    .withCommand("recordCostCenterChanged", RecordCostCenterChangedCommand)
    .build();
}

export const scimCostCenterEventing = defineEventingModule({
  pipeline: SCIM_COST_CENTER_PIPELINE_NAME,
  build: (_setup: EventingSetup<ScimRepositories, ScimModule>) => buildScimCostCenterPipeline(),
  connect: ({ app, commands }) => app.connectCostCenter(commands),
});
