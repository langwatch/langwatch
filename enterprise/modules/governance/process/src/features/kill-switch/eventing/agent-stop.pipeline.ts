// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The agent kill switch's eventing: one `agent_stop` aggregate per stop, its AgentStop Postgres
 * projection, its commands and, in the worker, the process manager that applies and reverts
 * targets, and the kill switch's audit outbox. The api only sends.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { type AuditLogIntent, auditLogIntentSchema } from "@langwatch/audit-log-contract";
import {
  AGENT_STOP_AGGREGATE_TYPE,
  agentStopApprovedEventSchema,
  agentStopDeniedEventSchema,
  agentStopRequestedEventSchema,
  agentStopRestoreRequestedEventSchema,
  agentStopRetryRequestedEventSchema,
  agentStopTargetAppliedEventSchema,
  agentStopTargetFailedEventSchema,
  agentStopTargetRevertedEventSchema,
  agentStopTargetRevertFailedEventSchema,
  agentStopTargetsDroppedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessStore,
  type Projection,
  type RegisteredCommand,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { z } from "zod";

import type { GovernanceModule } from "../../../app/governance.app.ts";
import type { GovernanceRepositories } from "../../../repositories/governance.repositories.ts";
import {
  KILL_SWITCH_AUDIT_PROCESS_NAME,
  KILL_SWITCH_AUDIT_RECORD_INTENT,
} from "../rules/kill-switch-audit.rules.ts";
import { AGENT_STOP_COMMANDS } from "./agent-stop.commands.ts";
import {
  AGENT_STOP_PROCESS_NAME,
  type AgentStopIntentExecutors,
  agentStopProcessManager,
} from "./agent-stop.process.ts";
import { type AgentStopProjectionState, agentStopProjection } from "./agent-stop.projection.ts";
import { pruneKillSwitchAudits } from "./kill-switch-audit.intent.ts";
import {
  KILL_SWITCH_AUDIT_INITIAL_STATE,
  KILL_SWITCH_AUDIT_MAX_ATTEMPTS,
  KILL_SWITCH_AUDIT_PRUNE_INTENT,
  KILL_SWITCH_AUDIT_PRUNE_INTERVAL_MS,
  killSwitchAuditPruneSchema,
  killSwitchAuditPruneWake,
  killSwitchAuditStateSchema,
} from "./kill-switch-audit.process.ts";

const AGENT_STOP_PIPELINE_NAME = "governance_agent_stop" as const;

type AgentStopEvent =
  | z.infer<typeof agentStopRequestedEventSchema>
  | z.infer<typeof agentStopApprovedEventSchema>
  | z.infer<typeof agentStopDeniedEventSchema>
  | z.infer<typeof agentStopTargetAppliedEventSchema>
  | z.infer<typeof agentStopTargetFailedEventSchema>
  | z.infer<typeof agentStopRestoreRequestedEventSchema>
  | z.infer<typeof agentStopTargetRevertedEventSchema>
  | z.infer<typeof agentStopTargetRevertFailedEventSchema>
  | z.infer<typeof agentStopRetryRequestedEventSchema>
  | z.infer<typeof agentStopTargetsDroppedEventSchema>;

export type AgentStopPipelineDefinition = StaticPipelineDefinition<
  AgentStopEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/** Writes one audit intent to the audit log, and prunes the outbox's delivered rows. */
export interface KillSwitchAuditOutboxHost {
  record: (intent: AuditLogIntent) => Promise<void>;
  processStore: Pick<ProcessStore, "deleteDispatchedBefore">;
}

/** The process managers are declared everywhere; only a consuming process (the worker) runs them. */
export function buildAgentStopPipeline({
  store,
  executors,
  audit,
  retryDelayMs,
}: {
  store: StateProjectionStore<AgentStopProjectionState>;
  executors: AgentStopIntentExecutors;
  audit: KillSwitchAuditOutboxHost;
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
      agentStopRetryRequestedEventSchema,
      agentStopTargetsDroppedEventSchema,
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
    .withCommand("retry", AGENT_STOP_COMMANDS.retry)
    .withCommand("dropTargets", AGENT_STOP_COMMANDS.dropTargets)
    .withProcessManager(
      AGENT_STOP_PROCESS_NAME,
      agentStopProcessManager({ executors, ...(retryDelayMs ? { retryDelayMs } : {}) }),
    )
    .withProcessManager(KILL_SWITCH_AUDIT_PROCESS_NAME, (pm) =>
      pm
        .state(killSwitchAuditStateSchema, KILL_SWITCH_AUDIT_INITIAL_STATE)
        .intent(KILL_SWITCH_AUDIT_RECORD_INTENT, auditLogIntentSchema, (intent) =>
          audit.record(intent),
        )
        .intent(
          KILL_SWITCH_AUDIT_PRUNE_INTENT,
          killSwitchAuditPruneSchema,
          pruneKillSwitchAudits(audit.processStore),
        )
        .schedule({ everyMs: KILL_SWITCH_AUDIT_PRUNE_INTERVAL_MS })
        .onWake(killSwitchAuditPruneWake)
        .outbox({ maxAttempts: KILL_SWITCH_AUDIT_MAX_ATTEMPTS }),
    )
    .build();
}

export const agentStopEventing = defineEventingModule({
  pipeline: AGENT_STOP_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<GovernanceRepositories, GovernanceModule>) => {
    app.connectKillSwitchAuditOutbox({ processStore });
    return app.agentStopPipeline({ processStore });
  },
  connect: ({ app, commands }) => app.connectAgentStop(commands),
});
