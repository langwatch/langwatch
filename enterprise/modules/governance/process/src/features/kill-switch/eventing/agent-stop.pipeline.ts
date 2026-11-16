// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The agent kill switch's eventing: one `agent_stop` aggregate per stop, its AgentStop Postgres
 * projection, its commands and, in the worker, the process manager that applies and reverts
 * targets. The api only sends. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import {
  AGENT_STOP_AGGREGATE_TYPE,
  agentStopApprovedEventSchema,
  agentStopDeniedEventSchema,
  agentStopRequestedEventSchema,
  agentStopRestoreRequestedEventSchema,
  agentStopTargetAppliedEventSchema,
  agentStopTargetFailedEventSchema,
  agentStopTargetRevertedEventSchema,
  agentStopTargetRevertFailedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { z } from "zod";

import type { GovernanceModule } from "../../../app/governance.app.ts";
import type { GovernanceRepositories } from "../../../repositories/governance.repositories.ts";
import { AGENT_STOP_COMMANDS } from "./agent-stop.commands.ts";
import {
  AGENT_STOP_PROCESS_NAME,
  type AgentStopIntentExecutors,
  agentStopProcessManager,
} from "./agent-stop.process.ts";
import { type AgentStopProjectionState, agentStopProjection } from "./agent-stop.projection.ts";

const AGENT_STOP_PIPELINE_NAME = "governance_agent_stop" as const;

type AgentStopEvent =
  | z.infer<typeof agentStopRequestedEventSchema>
  | z.infer<typeof agentStopApprovedEventSchema>
  | z.infer<typeof agentStopDeniedEventSchema>
  | z.infer<typeof agentStopTargetAppliedEventSchema>
  | z.infer<typeof agentStopTargetFailedEventSchema>
  | z.infer<typeof agentStopRestoreRequestedEventSchema>
  | z.infer<typeof agentStopTargetRevertedEventSchema>
  | z.infer<typeof agentStopTargetRevertFailedEventSchema>;

export type AgentStopPipelineDefinition = StaticPipelineDefinition<
  AgentStopEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/** The process manager is declared everywhere; only a consuming process (the worker) runs it. */
export function buildAgentStopPipeline({
  store,
  executors,
  retryDelayMs,
}: {
  store: StateProjectionStore<AgentStopProjectionState>;
  executors: AgentStopIntentExecutors;
  retryDelayMs?: (params: { attempt: number }) => number;
}): AgentStopPipelineDefinition {
  return definePipeline({
    name: AGENT_STOP_PIPELINE_NAME,
    aggregate: defineAggregate({ type: AGENT_STOP_AGGREGATE_TYPE }),
  })
    .withEvents([
      agentStopRequestedEventSchema,
      agentStopApprovedEventSchema,
      agentStopDeniedEventSchema,
      agentStopTargetAppliedEventSchema,
      agentStopTargetFailedEventSchema,
      agentStopRestoreRequestedEventSchema,
      agentStopTargetRevertedEventSchema,
      agentStopTargetRevertFailedEventSchema,
    ])
    .withPostgresProjection(agentStopProjection(store))
    .withCommand("request", AGENT_STOP_COMMANDS.request)
    .withCommand("approve", AGENT_STOP_COMMANDS.approve)
    .withCommand("deny", AGENT_STOP_COMMANDS.deny)
    .withCommand("recordTargetApplied", AGENT_STOP_COMMANDS.recordTargetApplied)
    .withCommand("recordTargetFailed", AGENT_STOP_COMMANDS.recordTargetFailed)
    .withCommand("requestRestore", AGENT_STOP_COMMANDS.requestRestore)
    .withCommand("recordTargetReverted", AGENT_STOP_COMMANDS.recordTargetReverted)
    .withCommand("recordTargetRevertFailed", AGENT_STOP_COMMANDS.recordTargetRevertFailed)
    .withProcessManager(
      AGENT_STOP_PROCESS_NAME,
      agentStopProcessManager({ executors, ...(retryDelayMs ? { retryDelayMs } : {}) }),
    )
    .build();
}

export const agentStopEventing = defineEventingModule({
  pipeline: AGENT_STOP_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<GovernanceRepositories, GovernanceModule>) =>
    app.agentStopPipeline({ participation }),
  connect: ({ app, commands }) => app.connectAgentStop(commands),
});
