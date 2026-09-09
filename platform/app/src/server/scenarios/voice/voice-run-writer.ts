/**
 * Writes a finished voice call down as a scenario-style run the results pages
 * render: one message per turn (caller → user, agent → assistant), the caller
 * marked human.
 *
 * Only a "Call it myself" scenario call is written here (#8020): it lands under
 * the real scenario id and its set, beside the scenario's simulated runs,
 * tagged `metadata.langwatch.callerKind = "human"`. Finishing it emits a
 * RunFinished that names the scenario, which is what the scenario-evaluations
 * subscriber keys on to grade the human transcript against the scenario's
 * attached evaluators — the same grading a simulated run gets. A drawer "Talk
 * to it" call has no scenario, so it is never written as a run at all; it
 * leaves only its per-exchange traces (3a).
 *
 * Kept apart from the session service so the service stays a pure orchestrator
 * over injected ports.
 */

import { HandledError } from "@langwatch/handled-error";

import { AgentRepository } from "~/server/agents/agent.repository";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import type { SimulationMessage } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/shared";
import type { CallRecord } from "./call-record";

/** How the run records who spoke as the caller: a person, not a simulator. */
export const HUMAN_CALLER_KIND = "human";

/**
 * The agent row a finish names does not exist in the project. The row id comes
 * from the signed token, but it is still checked against the project before a
 * run is written under it, so a stale or forged row id cannot create a run.
 */
export class VoiceAgentNotFoundError extends HandledError {
  declare readonly code: "agent_not_found";
  constructor() {
    super("agent_not_found", "The voice agent was not found in this project", {
      httpStatus: 404,
    });
    this.name = "VoiceAgentNotFoundError";
  }
}

/**
 * Message ids derive from the run id and the turn index, not from anything
 * random, so a re-driven snapshot (a retried hang-up completing a half-written
 * run — #7973) carries the identical ids and overwrites the same messages
 * rather than duplicating them.
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

export async function writeVoiceCallRun({
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
  /** The trace id each turn links to, one per `record.turns[i]` in order, from
   *  {@link recordVoiceCallTraces}. Set on the message and the run's trace list
   *  so the drawer probes the exchange's trace. */
  turnTraceIds: readonly string[];
}): Promise<void> {
  // The row id is trusted only as far as the token that carried it; the row
  // itself must exist in this project before a run is written under it.
  const agent = await new AgentRepository(prisma).findById({
    projectId,
    id: agentRowId,
  });
  if (!agent) throw new VoiceAgentNotFoundError();

  // The call lands under the real scenario and its set, beside that scenario's
  // simulated runs.
  const scenarioId = scenario.scenarioId;
  const scenarioSetId = scenario.scenarioSetId;

  const metadata = {
    name: agentDisplayName,
    caller: "You",
    // The results table and run header read the caller off langwatch metadata,
    // the same place a simulated run records "simulated" (AC24), so a scenario
    // call shows "You" in the scenario's run list beside them.
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

  await getApp().simulations.startRun({
    tenantId: projectId,
    scenarioRunId,
    scenarioId,
    batchRunId: scenarioRunId,
    scenarioSetId,
    name: agentDisplayName,
    metadata,
    occurredAt: record.startedAt,
  });

  await getApp().simulations.messageSnapshot({
    tenantId: projectId,
    scenarioRunId,
    messages: toMessages(record, scenarioRunId, turnTraceIds),
    // The run-level trace list may repeat an id (two turns share their
    // exchange's trace), mirroring the SDK; the fold dedupes it.
    traceIds: [...turnTraceIds],
    occurredAt: record.endedAt,
  });

  // No results envelope: the verdict is not decided here. The run is finished
  // SUCCESS with the scenario id named on the event, so the scenario-evaluations
  // subscriber grades the transcript against the scenario's attached evaluators
  // (AC23) — exactly the path a simulated run's finish takes.
  await getApp().simulations.finishRun({
    tenantId: projectId,
    scenarioRunId,
    status: "SUCCESS",
    scenarioId: scenario.scenarioId,
    scenarioSetId: scenario.scenarioSetId,
    batchRunId: scenarioRunId,
    occurredAt: record.endedAt,
  });
}
