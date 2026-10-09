import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { AgentModule } from "../app/agent.app.ts";
import type { AgentRepositories } from "../repositories/agent.repositories.ts";
import {
  AGENT_AGGREGATE_TYPE,
  AGENT_LIFECYCLE_PIPELINE_NAME,
  agentArchivedEventSchema,
  type AgentLifecycleEvent,
  RecordAgentArchivedCommand,
  type RecordAgentArchivedCommandData,
} from "./agent-lifecycle.commands.ts";

export type AgentLifecyclePipeline = StaticPipelineDefinition<
  AgentLifecycleEvent,
  Record<string, Projection>,
  { name: "recordAgentArchived"; payload: RecordAgentArchivedCommandData }
>;

/** The api sends the command; peers (workflow) react to its event from their own side (§9). */
export function buildAgentLifecyclePipeline(): AgentLifecyclePipeline {
  return definePipeline({
    name: AGENT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: AGENT_AGGREGATE_TYPE }),
  })
    .withEvents([agentArchivedEventSchema])
    .withCommand("recordAgentArchived", RecordAgentArchivedCommand)
    .build();
}

export const agentLifecycleEventing = defineEventingModule({
  pipeline: AGENT_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AgentRepositories, AgentModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
