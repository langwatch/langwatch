/**
 * Writes a finished voice call down as a scenario-style run the results pages
 * render: one message per turn (caller → user, agent → assistant), the caller
 * marked human, and no verdict — a drawer call is not judged against a scenario
 * (AC13). Kept apart from the session service so the service stays a pure
 * orchestrator over injected ports.
 */

import { VOICE_CALL_SCENARIO_SET_ID } from "~/server/agents/voice/voice-agent.config";
import { getApp } from "~/server/app-layer/app";
import type { CallRecord } from "./call-record";

/** How the run records who spoke as the caller: a person, not a simulator. */
export const HUMAN_CALLER_KIND = "human";

interface VoiceRunMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Per-turn recording, when the provider exposed one. */
  audioUrl?: string;
}

function toMessages(record: CallRecord): VoiceRunMessage[] {
  return record.turns.map((turn, index) => ({
    id: `${record.conversationId}-${index}`,
    role: turn.role === "agent" ? "assistant" : "user",
    content: turn.text,
    ...(turn.audioUrl ? { audioUrl: turn.audioUrl } : {}),
  }));
}

export async function writeVoiceCallRun({
  projectId,
  scenarioRunId,
  agentRowId,
  agentDisplayName,
  record,
}: {
  projectId: string;
  scenarioRunId: string;
  agentRowId: string;
  agentDisplayName: string;
  record: CallRecord;
}): Promise<void> {
  const scenarioId = `voiceagent_${agentRowId}`;
  const metadata = {
    name: agentDisplayName,
    caller: "You",
    callerKind: HUMAN_CALLER_KIND,
    source: record.source,
    transport: record.transport,
    conversationId: record.conversationId,
    agentId: agentRowId,
    cutAtLimit: record.cutAtLimit,
    ...(record.audioUrl ? { audioUrl: record.audioUrl } : {}),
  };

  await getApp().simulations.startRun({
    tenantId: projectId,
    scenarioRunId,
    scenarioId,
    batchRunId: scenarioRunId,
    scenarioSetId: VOICE_CALL_SCENARIO_SET_ID,
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

  // No results envelope: a drawer call carries no verdict (AC13). The status is
  // SUCCESS — the call completed — while the absence of results leaves the run
  // unjudged.
  await getApp().simulations.finishRun({
    tenantId: projectId,
    scenarioRunId,
    status: "SUCCESS",
    occurredAt: record.endedAt,
  });
}
