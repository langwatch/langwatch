/**
 * Writes a finished voice call down as a scenario-style run the results pages
 * render: one message per turn (caller → user, agent → assistant), the caller
 * marked human.
 *
 * Two shapes, one writer:
 *  - A drawer call ("Talk to it") lands in the voice-call set under a synthetic
 *    per-agent scenario id, and carries no verdict — it is not judged against a
 *    scenario (AC13).
 *  - A "Call it myself" scenario call (AC23) lands under the real scenario id
 *    and its set, beside the scenario's simulated runs, tagged
 *    `metadata.langwatch.callerKind = "human"`. Finishing it emits a
 *    RunFinished that names the scenario, which is what the scenario-evaluations
 *    subscriber keys on to grade the human transcript against the scenario's
 *    attached evaluators — the same grading a simulated run gets.
 *
 * Kept apart from the session service so the service stays a pure orchestrator
 * over injected ports.
 */

import { HandledError } from "@langwatch/handled-error";

import { AgentRepository } from "~/server/agents/agent.repository";
import { VOICE_CALL_SCENARIO_SET_ID } from "~/server/agents/voice/voice-agent.config";
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

function toMessages(record: CallRecord): SimulationMessage[] {
  return record.turns.map((turn, index) => ({
    id: `${record.conversationId}-${index}`,
    role: turn.role === "agent" ? "assistant" : "user",
    content: turn.text,
    ...(turn.audioUrl ? { audioUrl: turn.audioUrl } : {}),
  }));
}

/**
 * The scenario a "Call it myself" run is written under, and the set it shares
 * with that scenario's simulated runs. Absent for a drawer call.
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
}: {
  projectId: string;
  scenarioRunId: string;
  agentRowId: string;
  agentDisplayName: string;
  record: CallRecord;
  scenario?: VoiceRunScenario;
}): Promise<void> {
  // The row id is trusted only as far as the token that carried it; the row
  // itself must exist in this project before a run is written under it.
  const agent = await new AgentRepository(prisma).findById({
    projectId,
    id: agentRowId,
  });
  if (!agent) throw new VoiceAgentNotFoundError();

  // A scenario call lands under the real scenario and its set; a drawer call
  // lands in the voice-call set under a synthetic per-agent id.
  const scenarioId = scenario?.scenarioId ?? `voiceagent_${agentRowId}`;
  const scenarioSetId = scenario?.scenarioSetId ?? VOICE_CALL_SCENARIO_SET_ID;

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
      cutAtLimit: record.isCutAtLimit,
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
    messages: toMessages(record),
    traceIds: [],
    occurredAt: record.endedAt,
  });

  // No results envelope: the verdict is not decided here. A drawer call carries
  // no verdict at all (AC13). A scenario call is finished SUCCESS with the
  // scenario id named on the event, so the scenario-evaluations subscriber
  // grades the transcript against the scenario's attached evaluators (AC23) —
  // exactly the path a simulated run's finish takes.
  await getApp().simulations.finishRun({
    tenantId: projectId,
    scenarioRunId,
    status: "SUCCESS",
    ...(scenario
      ? {
          scenarioId: scenario.scenarioId,
          scenarioSetId: scenario.scenarioSetId,
          batchRunId: scenarioRunId,
        }
      : {}),
    occurredAt: record.endedAt,
  });
}
