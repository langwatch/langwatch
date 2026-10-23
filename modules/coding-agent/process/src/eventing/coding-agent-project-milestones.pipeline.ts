import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";

import type { CodingAgentModule } from "../app/coding-agent.app.ts";
import { RecordCodingAgentSessionStoredCommand } from "./coding-agent-project-milestones.commands.ts";
import {
  CODING_AGENT_PROJECT_MILESTONE_AGGREGATE_TYPE,
  CODING_AGENT_PROJECT_MILESTONES_PIPELINE_NAME,
  codingAgentSessionStoredEventSchema,
} from "./coding-agent-project-milestones.events.ts";

function milestoneCommands(retention?: RetentionPolicyResolver) {
  const pipeline = definePipeline({
    name: CODING_AGENT_PROJECT_MILESTONES_PIPELINE_NAME,
    aggregate: defineAggregate({ type: CODING_AGENT_PROJECT_MILESTONE_AGGREGATE_TYPE }),
  })
    .withEvents([codingAgentSessionStoredEventSchema])
    .withCommand("recordSessionStored", RecordCodingAgentSessionStoredCommand);
  return retention === undefined ? pipeline : pipeline.withRetention(retention);
}

export type CodingAgentProjectMilestonesDefinition = ReturnType<
  ReturnType<typeof milestoneCommands>["build"]
>;

/** coding_agent_project_milestones records; peer modules react from their side (§9). */
export function buildCodingAgentProjectMilestonesPipeline(
  retention?: RetentionPolicyResolver,
): CodingAgentProjectMilestonesDefinition {
  return milestoneCommands(retention).build();
}

export const codingAgentProjectMilestonesEventing = defineEventingModule({
  pipeline: CODING_AGENT_PROJECT_MILESTONES_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, CodingAgentModule>) => app.projectMilestonesPipeline(),
  connect: ({ app, commands }) => app.connectProjectMilestones(commands),
});
