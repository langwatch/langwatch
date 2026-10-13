import {
  browserTranscriptToCallRecord,
  ScenarioRunStatus,
  VoiceConversationMismatchError,
  type BrowserTranscriptTurn,
  type CallRecord,
  type VoiceSessionFinishResult,
  type VoiceSessionTokenPayload,
  type VoiceTransport,
} from "@langwatch/scenario-contract";

/** A run already written for a conversation, as a finish or a replay reads it back. */
export type VoiceSessionExistingRun = {
  agentId: string | null;
  status: ScenarioRunStatus;
  source: CallRecord["source"] | null;
  audioUrl: string | null;
  /** The scenario the run was written under, reused on a re-drive so a
   *  scenario archived between attempts cannot break the retry (#7973 AC1).
   *  Null when the run carries none (a drawer call). */
  scenarioId: string | null;
  /** The set the run landed in, so a terminal retry deep-links it (AC14).
   *  Null when the run carries none (a drawer call). */
  scenarioSetId: string | null;
};

/**
 * The result for a terminal run returned untouched: a duplicate finish
 * writes nothing (AC14, #7973 AC1). The scenario is deliberately not
 * re-resolved, so an archived scenario cannot break the retry (#7973 AC1).
 */
export function terminalRunResult({
  scenarioRunId,
  token,
  existing,
}: {
  scenarioRunId: string;
  token: VoiceSessionTokenPayload;
  existing: VoiceSessionExistingRun;
}): VoiceSessionFinishResult {
  return {
    runId: scenarioRunId,
    agentId: token.agentId ?? existing.agentId ?? "",
    source: existing.source ?? "provider",
    hasFetchFailed: false,
    hasAudio: existing.audioUrl !== null,
    audioUrl: existing.audioUrl ?? undefined,
    scenarioSetId: existing.scenarioSetId ?? undefined,
  };
}

/**
 * A provider record must have run against the very agent the token was minted
 * for. Anything else — including a record with no agent id at all — is a
 * conversation this session has no claim to, and nothing is written (AC13).
 */
export function assertProviderRecordMatchesToken(
  providerRecord: CallRecord | null,
  token: VoiceSessionTokenPayload,
): void {
  if (providerRecord && providerRecord.agentExternalId !== token.agentExternalId) {
    throw new VoiceConversationMismatchError();
  }
}

// Record to write: provider's when it holds turns, else browser transcript.
// Provider with empty turns loses conversation; prefer browser to avoid "no response" (#8019).
export function selectCallRecord({
  providerRecord,
  transcript,
  conversationId,
  transport,
  startedAt,
  endedAt,
  isCutAtLimit,
}: {
  providerRecord: CallRecord | null;
  transcript: BrowserTranscriptTurn[];
  conversationId: string;
  transport: VoiceTransport;
  startedAt: number;
  endedAt: number;
  isCutAtLimit: boolean;
}): CallRecord {
  // The provider's record when it actually holds turns.
  if (providerRecord && providerRecord.turns.length > 0) {
    return { ...providerRecord, isCutAtLimit };
  }
  const browserRecord = browserTranscriptToCallRecord({
    conversationId,
    transport,
    transcript,
    startedAt,
    endedAt,
    isCutAtLimit,
  });
  // No provider turns, but the browser captured the conversation: keep it
  // rather than write an empty run the reader sees as "no response" (#8019).
  // The turns come from the browser, but a recording the provider already
  // returned is still this call's audio.
  if (transcript.length > 0) {
    return {
      ...browserRecord,
      ...(providerRecord?.audioUrl ? { audioUrl: providerRecord.audioUrl } : {}),
    };
  }
  // Neither side has turns: keep the (empty) provider record when one came
  // back, else the empty browser record.
  return providerRecord ? { ...providerRecord, isCutAtLimit } : browserRecord;
}

/** Statuses that mean the finish write already completed: only these are
 *  returned untouched on a retry (#7973 AC1). */
export const WRITTEN_STATUSES: ReadonlySet<ScenarioRunStatus> = new Set([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
]);
