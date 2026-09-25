/**
 * Writes finished voice call as scenario-style run: one message per turn (caller/user,
 * agent/assistant), marked human. Only scenario calls (#8020) written; drawer calls leave
 * only per-exchange traces.
 */

import {
  VoiceAgentNotFoundError,
  type CallRecord,
  type SimulationMessage,
  type SimulationService,
  type VoiceSessionInfrastructure,
} from "@langwatch/scenario-contract";

/**
 * What the write reaches outside itself: the project's agent rows and the
 * simulation run lifecycle, both from the module's composition, not a
 * global locator — so a unit test composes it against in-memory fakes.
 */
export interface VoiceCallRunWriterCollaborators {
  agents: {
    findById(input: { projectId: string; id: string }): Promise<{ id: string } | null>;
  };
  simulations: Pick<SimulationService, "startRun" | "messageSnapshot" | "finishRun">;
}

/** How the run records who spoke as the caller: a person, not a simulator. */
export const HUMAN_CALLER_KIND = "human";

/**
 * Message ids derive from the run id and turn index, not anything random,
 * so a re-driven snapshot (a retried hang-up completing a half-written run
 * — #7973) overwrites the same messages instead of duplicating them.
 */
function toMessages(
  record: CallRecord,
  scenarioRunId: string,
  turnTraceIds: readonly string[],
): SimulationMessage[] {
  return record.turns.map((turn, index) => ({
    id: `${scenarioRunId}-${index}`,
    role: turn.role === "agent" ? "assistant" : "user",
    content: turn.text,
    // Links the message to its exchange's trace so the drawer can render the
    // trace-preview separator (it probes `msg.trace_id`).
    ...(turnTraceIds[index] ? { trace_id: turnTraceIds[index] } : {}),
    ...(turn.audioUrl ? { audioUrl: turn.audioUrl } : {}),
  }));
}

/**
 * The scenario a "Call it myself" run is written under, and the set it shares
 * with that scenario's simulated runs. Always present: only a scenario call is
 * ever written as a run (#8020).
 */
export interface VoiceRunScenario {
  scenarioId: string;
  scenarioSetId: string;
}

/**
 * Binds the write to the collaborators it runs against and returns the
 * {@link VoiceSessionInfrastructure.writeCallRun} the voice session service
 * calls.
 */
export function createVoiceCallRunWriter(
  collaborators: VoiceCallRunWriterCollaborators,
): VoiceSessionInfrastructure["writeCallRun"] {
  return async function writeVoiceCallRun({
    projectId,
    scenarioRunId,
    agentRowId,
    agentDisplayName,
    record,
    scenario,
    turnTraceIds,
  }: {
    projectId: string;
    scenarioRunId: string;
    agentRowId: string;
    agentDisplayName: string;
    record: CallRecord;
    scenario: VoiceRunScenario;
    /** The trace id each turn links to, one per `record.turns[i]` in order,
     *  from {@link recordVoiceCallTraces}. Set on the message and the run's
     *  trace list so the drawer probes the exchange's trace. */
    turnTraceIds: readonly string[];
  }): Promise<void> {
    // The row id is trusted only as far as the token that carried it; the row
    // itself must exist in this project before a run is written under it.
    const agent = await collaborators.agents.findById({
      projectId,
      id: agentRowId,
    });
    if (!agent) throw new VoiceAgentNotFoundError();

    // The call lands under the real scenario and its set, beside that
    // scenario's simulated runs.
    const scenarioId = scenario.scenarioId;
    const scenarioSetId = scenario.scenarioSetId;

    const metadata = {
      name: agentDisplayName,
      caller: "You",
      // The results table and run header read the caller off langwatch
      // metadata, the same place a simulated run records "simulated" (AC24),
      // so a scenario call shows "You" in the scenario's run list beside them.
      langwatch: {
        targetType: "voice" as const,
        targetReferenceId: agentRowId,
        callerKind: HUMAN_CALLER_KIND,
        isCutAtLimit: record.isCutAtLimit,
      },
      callerKind: HUMAN_CALLER_KIND,
      source: record.source,
      transport: record.transport,
      conversationId: record.conversationId,
      agentId: agentRowId,
      ...(record.audioUrl ? { audioUrl: record.audioUrl } : {}),
    };

    await collaborators.simulations.startRun({
      tenantId: projectId,
      scenarioRunId,
      scenarioId,
      batchRunId: scenarioRunId,
      scenarioSetId,
      name: agentDisplayName,
      metadata,
      occurredAt: record.startedAt,
    });

    await collaborators.simulations.messageSnapshot({
      tenantId: projectId,
      scenarioRunId,
      messages: toMessages(record, scenarioRunId, turnTraceIds),
      // The run-level trace list may repeat an id (two turns share their
      // exchange's trace), mirroring the SDK; the fold dedupes it.
      traceIds: [...turnTraceIds],
      occurredAt: record.endedAt,
    });

    // No results envelope: the verdict is not decided here. The run is
    // finished SUCCESS with the scenario id named on the event, so the
    // scenario_evaluations process manager grades the transcript against the
    // scenario's attached evaluators (AC23): exactly the path a simulated
    // run's finish takes.
    await collaborators.simulations.finishRun({
      tenantId: projectId,
      scenarioRunId,
      status: "SUCCESS",
      scenarioId: scenario.scenarioId,
      scenarioSetId: scenario.scenarioSetId,
      batchRunId: scenarioRunId,
      occurredAt: record.endedAt,
    });
  };
}
