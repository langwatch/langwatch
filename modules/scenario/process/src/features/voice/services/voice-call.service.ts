// "Talk to it": mint browser call sessions and ingest finished calls as runs.
// Infrastructure injection enables unit testing with fakes; transports plugged via registry.

import { HandledError } from "@langwatch/handled-error";
import {
  type BrowserTranscriptTurn,
  type CallRecord,
  type VoiceSessionFinishResult,
  type VoiceSessionMintResult,
  type VoiceSessionTokenPayload,
  type VoiceTransport,
  VoiceNameRequiredError,
  VoiceScenarioNotFoundError,
} from "@langwatch/scenario-contract";

import {
  type ElevenLabsCredential,
  type VoiceTransportCredential,
  type VoiceTransportRunner,
} from "../../../channels/voice-transport.channel.ts";
import {
  assertProviderRecordMatchesToken,
  selectCallRecord,
  terminalRunResult,
  WRITTEN_STATUSES,
  type VoiceSessionExistingRun,
} from "../../../rules/voice-call-finish.rules.ts";
import { scenarioRunIdForConversation } from "../../../rules/voice-call-record.rules.ts";
import { VoiceCallMintService } from "./voice-call-mint.service.ts";
import { VoiceCallPlaybackService } from "./voice-call-playback.service.ts";

export type VoiceCallMintInput = {
  projectId: string;
  transport: VoiceTransport;
  /** The vendor agent id from the form. Used only when there is no saved
   *  row yet — a saved row's own vendor id always wins. */
  agentId: string;
  /** The saved agent row id, when the drawer already has one. */
  agentRowId?: string;
  maxDurationSeconds: number;
};

export type VoiceCallFinishInput = {
  /** The verified session token: the project, transport, agent row and
   *  vendor agent id are read from here, never from the request body. */
  token: VoiceSessionTokenPayload;
  projectId: string;
  name?: string;
  transcript: BrowserTranscriptTurn[];
  startedAt: number;
  endedAt: number;
  isCutAtLimit: boolean;
  conversationId?: string;
  /** Set for a "Call it myself" run: the scenario the call is scored under
   *  (AC23). Absent for a drawer call, which is not written as a run (#8020). */
  scenarioId?: string;
};

export type VoiceCallPlaybackInput = {
  projectId: string;
  conversationId: string;
};

export interface VoiceSessionInfrastructure {
  /** The provider key and host for this project's transport. Throws
   *  `VoiceKeyMissingError`, with the transport's own message, when none is set. */
  getCredential(input: {
    projectId: string;
    transport: VoiceTransport;
  }): Promise<VoiceTransportCredential>;
  /** The vendor agent id stored on the project's voice agent row; throws
   *  `agent_not_found` when the row is missing or not type "voice". This —
   *  never the request body — is what a mint is minted against. */
  getVoiceAgentRow(input: {
    projectId: string;
    agentRowId: string;
  }): Promise<{ id: string; agentExternalId: string }>;
  /** Whether this project saved a voice agent for the given vendor agent id,
   *  matched on the row's identity key. A drawer call writes no run to check
   *  playback against (#8020), so this is what authorizes its recording. */
  hasVoiceAgentForExternalId(input: {
    projectId: string;
    transport: VoiceTransport;
    agentExternalId: string;
  }): Promise<boolean>;
  /** The run already written for this id, or null. Returns the agent id it
   *  attached so a duplicate finish can answer with it, and the run status so a
   *  finish short-circuits on a written run but re-drives a half-written one
   *  (#7973). Also returns the persisted scenario and set so a re-drive reuses
   *  them rather than re-resolving a scenario that may since be archived. */
  findExistingRun(input: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<VoiceSessionExistingRun | null>;
  /** Create the voice agent row on hang-up when the drawer had none yet. */
  createVoiceAgent(input: {
    projectId: string;
    name: string;
    transport: VoiceTransport;
    agentId: string;
  }): Promise<{ id: string }>;
  /** Record one trace per exchange of the call, before the run is written, and
   *  return the per-turn trace ids (one per `record.turns[i]`, in order) so the
   *  run write links each message to its exchange's trace. Best effort: a
   *  recording failure is swallowed and the ids are still returned (decision 7).
   *  Re-run on a re-drive — the ids are deterministic, so the fold dedupes. */
  recordCallTraces(input: {
    projectId: string;
    record: CallRecord;
    scenario?: { scenarioId: string; scenarioSetId: string };
    scenarioRunId: string;
  }): Promise<{ turnTraceIds: string[] }>;
  /** Write the call down as a run the results pages render. Only ever called
   *  for a "Call it myself" call, so `scenario` is always named: the run lands
   *  under that scenario and its set and is judged. A drawer call is never
   *  written as a run (#8020). */
  writeCallRun(input: {
    projectId: string;
    scenarioRunId: string;
    agentRowId: string;
    agentDisplayName: string;
    record: CallRecord;
    scenario: { scenarioId: string; scenarioSetId: string };
    turnTraceIds: readonly string[];
  }): Promise<void>;
  /** The set a scenario's runs are listed under, so a "Call it myself" run
   *  lands beside its simulated runs. Throws `scenario_not_found` when the
   *  scenario is gone. Absent when the deployment never runs scenario calls. */
  getScenarioSet?(input: {
    projectId: string;
    scenarioId: string;
  }): Promise<{ scenarioSetId: string }>;
  /** Same-origin proxy path the browser plays the recording through. Carries
   *  the project so the proxy can authorise the fetch. */
  audioProxyUrl(input: { conversationId: string; projectId: string }): string;
  /** Sign the session claims into the token the browser carries mint→finish. */
  signSessionToken(payload: VoiceSessionTokenPayload): string;
  now(): number;
  newSessionId(): string;
  registry: Record<VoiceTransport, VoiceTransportRunner>;
}

function runnerFor(
  ports: VoiceSessionInfrastructure,
  transport: VoiceTransport,
): VoiceTransportRunner {
  return ports.registry[transport];
}

/**
 * Read the provider's record for a conversation, or fall back. Returns the
 * record (null when none yet or no key) and whether the fetch itself failed,
 * as opposed to "not ready", so the caller can mark the notice (AC15).
 */
async function fetchProviderRecord(
  ports: VoiceSessionInfrastructure,
  {
    transport,
    conversationId,
    projectId,
  }: { transport: VoiceTransport; conversationId: string; projectId: string },
): Promise<{ record: CallRecord | null; hasFetchFailed: boolean }> {
  const runner = runnerFor(ports, transport);
  runner.assertAvailable?.();
  let credential: VoiceTransportCredential;
  try {
    credential = await ports.getCredential({ projectId, transport });
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === "voice_key_missing") {
      return { record: null, hasFetchFailed: false };
    }
    throw error;
  }
  try {
    const record = await runner.getCallRecord({
      conversationId,
      credential,
      audioProxyUrl: ports.audioProxyUrl({ conversationId, projectId }),
    });
    return { record, hasFetchFailed: false };
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === "voice_call_record_not_ready") {
      return { record: null, hasFetchFailed: false };
    }
    return { record: null, hasFetchFailed: true };
  }
}

/**
 * Resolve the agent row the run is written under: reuse the one the token
 * carries, else create it from the form values. A create needs a name; without
 * one the panel collects it and retries (throws {@link VoiceNameRequiredError}).
 */
async function resolveAgentRow(
  ports: VoiceSessionInfrastructure,
  {
    token,
    projectId,
    transport,
    name,
    existingAgentId,
  }: {
    token: VoiceSessionTokenPayload;
    projectId: string;
    transport: VoiceTransport;
    name?: string;
    /** The agent id a half-written run already attached: reused on a re-drive
     *  so a retried drawer finish does not create a second agent (#7973). */
    existingAgentId?: string;
  },
): Promise<{ agentRowId: string; agentDisplayName: string }> {
  const trimmedName = name?.trim() ?? "";
  if (token.agentId) {
    return {
      agentRowId: token.agentId,
      agentDisplayName: trimmedName || token.agentExternalId,
    };
  }
  if (existingAgentId) {
    return {
      agentRowId: existingAgentId,
      agentDisplayName: trimmedName || token.agentExternalId,
    };
  }
  if (!trimmedName) throw new VoiceNameRequiredError();
  const created = await ports.createVoiceAgent({
    projectId,
    name: trimmedName,
    transport,
    agentId: token.agentExternalId,
  });
  return { agentRowId: created.id, agentDisplayName: trimmedName };
}

/**
 * Resolve the scenario a "Call it myself" run is written under and the set
 * it shares with its simulated runs (AC23). An unresolved name throws
 * VoiceScenarioNotFoundError rather than write an unscored run (#8019).
 */
async function resolveScenarioContext(
  ports: VoiceSessionInfrastructure,
  { projectId, scenarioId }: { projectId: string; scenarioId: string },
): Promise<{ scenarioId: string; scenarioSetId: string }> {
  if (!ports.getScenarioSet) throw new VoiceScenarioNotFoundError();
  const scenario = await ports.getScenarioSet({ projectId, scenarioId });
  return { scenarioId, scenarioSetId: scenario.scenarioSetId };
}

/**
 * The shared tail of a finished call: read the provider record (or fall
 * back to the transcript), reject an unclaimed token, resolve the agent row
 * and record one trace per exchange. A drawer call stops here; a scenario goes on.
 */
async function ingestFinishedCall(
  input: {
    ports: VoiceSessionInfrastructure;
    token: VoiceSessionTokenPayload;
    projectId: string;
    name?: string;
    transcript: BrowserTranscriptTurn[];
    startedAt: number;
    endedAt: number;
    isCutAtLimit: boolean;
  },
  {
    transport,
    conversationId,
    scenarioRunId,
    scenario,
    existingAgentId,
  }: {
    transport: VoiceTransport;
    conversationId: string;
    scenarioRunId: string;
    scenario?: { scenarioId: string; scenarioSetId: string };
    existingAgentId?: string;
  },
): Promise<{
  record: CallRecord;
  hasFetchFailed: boolean;
  agentRowId: string;
  agentDisplayName: string;
  turnTraceIds: readonly string[];
}> {
  const { ports, token } = input;

  // Prefer the provider's record; fall back to the live transcript when it is
  // not ready or the fetch fails. Fetched BEFORE the agent row is created so a
  // mismatched conversation is rejected without leaving an orphan agent behind.
  const { record: providerRecord, hasFetchFailed } = await fetchProviderRecord(ports, {
    transport,
    conversationId,
    projectId: input.projectId,
  });

  assertProviderRecordMatchesToken(providerRecord, token);

  const { agentRowId, agentDisplayName } = await resolveAgentRow(ports, {
    token,
    projectId: input.projectId,
    transport,
    name: input.name,
    existingAgentId,
  });

  const record = selectCallRecord({
    providerRecord,
    transcript: input.transcript,
    conversationId,
    transport,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    isCutAtLimit: input.isCutAtLimit,
  });

  // Record one trace per exchange before any run is written, so every message
  // links to its exchange's trace (3a). Best effort: recording failures are
  // swallowed inside the port, and the ids come back regardless (decision 7).
  // Re-run on a re-drive: the ids are deterministic, so the fold dedupes.
  const { turnTraceIds } = await ports.recordCallTraces({
    projectId: input.projectId,
    record,
    scenarioRunId,
    ...(scenario ? { scenario } : {}),
  });

  return { record, hasFetchFailed, agentRowId, agentDisplayName, turnTraceIds };
}

// Finish drawer call: traces recorded (3a) but NOT written as run (#8020).
// Agent row created on hang-up, deduped so retry reuses row rather than creating second.
async function finishDrawerCall(
  input: {
    ports: VoiceSessionInfrastructure;
    token: VoiceSessionTokenPayload;
    projectId: string;
    name?: string;
    transcript: BrowserTranscriptTurn[];
    startedAt: number;
    endedAt: number;
    isCutAtLimit: boolean;
  },
  {
    transport,
    conversationId,
    scenarioRunId,
  }: {
    transport: VoiceTransport;
    conversationId: string;
    scenarioRunId: string;
  },
): Promise<VoiceSessionFinishResult> {
  const { record, hasFetchFailed, agentRowId } = await ingestFinishedCall(input, {
    transport,
    conversationId,
    scenarioRunId,
  });

  return {
    // No run: a drawer call is not persisted as one (#8020). The agent id is
    // still returned so the panel can register the row it just created.
    runId: "",
    agentId: agentRowId,
    source: record.source,
    hasFetchFailed,
    hasAudio: Boolean(record.audioUrl),
    audioUrl: record.audioUrl,
  };
}

// Ingest finished call: drawer (traces only) or scenario (run written and judged).
// Fully written runs returned untouched (AC14); half-written re-driven (#7973).
async function finishVoiceSession(
  input: VoiceCallFinishInput & { ports: VoiceSessionInfrastructure },
): Promise<VoiceSessionFinishResult> {
  const { ports, token } = input;
  const transport = token.transport;
  const conversationId = input.conversationId?.trim() || token.sessionId;
  const scenarioRunId = scenarioRunIdForConversation(conversationId);

  // A drawer call is scored against no scenario, so it is never written as a
  // run: there is never a run to find, re-drive or write for its conversation id
  // (#8020). It still records its traces and creates the agent row.
  if (!input.scenarioId) {
    return finishDrawerCall(input, {
      transport,
      conversationId,
      scenarioRunId,
    });
  }

  // Terminal run is complete (AC14, #7973 AC1); half-written re-driven with same id (#7973 AC2).
  // Checked BEFORE scenario resolution so archived scenario cannot break retry (#7973 AC1).
  const existing = await ports.findExistingRun({
    projectId: input.projectId,
    scenarioRunId,
  });
  // The question is "did the finish write already complete?", not "is the run
  // terminal?": ERROR, CANCELLED and STALLED are terminal too, and answering a
  // retry after one of those with the empty terminal result would drop the
  // caller's transcript — the loss #7973 exists to close. Only a written run is
  // returned untouched; anything else re-drives writeCallRun (#7973 AC2).
  if (existing && WRITTEN_STATUSES.has(existing.status)) {
    return terminalRunResult({ scenarioRunId, token, existing });
  }

  // A re-drive reuses the scenario the half-written run already landed under,
  // rather than re-resolving it: a scenario archived between the two attempts
  // would now throw scenario_not_found and the run could never complete (#7973
  // AC1). Only a fresh finish (no existing run) resolves the scenario set.
  const scenarioContext =
    existing && existing.scenarioId !== null && existing.scenarioSetId !== null
      ? {
          scenarioId: existing.scenarioId,
          scenarioSetId: existing.scenarioSetId,
        }
      : await resolveScenarioContext(ports, {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
        });

  const { record, hasFetchFailed, agentRowId, agentDisplayName, turnTraceIds } =
    await ingestFinishedCall(input, {
      transport,
      conversationId,
      scenarioRunId,
      scenario: scenarioContext,
      existingAgentId: existing?.agentId ?? undefined,
    });

  await ports.writeCallRun({
    projectId: input.projectId,
    scenarioRunId,
    agentRowId,
    agentDisplayName,
    record,
    turnTraceIds,
    scenario: scenarioContext,
  });

  return {
    runId: scenarioRunId,
    agentId: agentRowId,
    source: record.source,
    hasFetchFailed,
    hasAudio: Boolean(record.audioUrl),
    audioUrl: record.audioUrl,
    scenarioSetId: scenarioContext.scenarioSetId,
  };
}

/** The call lifecycle behind a browser session: mint, ingest the finished call, gate playback. */
export class VoiceCallService {
  static create(ports: VoiceSessionInfrastructure): VoiceCallService {
    return new VoiceCallService(ports);
  }

  private readonly minting: VoiceCallMintService;
  private readonly playback: VoiceCallPlaybackService;

  private constructor(private readonly ports: VoiceSessionInfrastructure) {
    this.minting = VoiceCallMintService.create(ports);
    this.playback = VoiceCallPlaybackService.create(ports);
  }

  mint(input: VoiceCallMintInput): Promise<VoiceSessionMintResult> {
    return this.minting.mint(input);
  }

  finish(input: VoiceCallFinishInput): Promise<VoiceSessionFinishResult> {
    return finishVoiceSession({ ...input, ports: this.ports });
  }

  authorizeRecordingPlayback(input: VoiceCallPlaybackInput): Promise<ElevenLabsCredential> {
    return this.playback.authorizeRecordingPlayback(input);
  }
}
