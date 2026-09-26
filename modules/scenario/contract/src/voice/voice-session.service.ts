// Service for "Talk to it": mint browser call sessions and ingest finished calls as runs.
// Infrastructure injection enables unit testing with fakes; transports plugged via registry.

import { VOICE_AGENTS_DISABLED_MESSAGE } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";

import { ScenarioRunStatus } from "../scenario-run.ts";
import {
  type BrowserTranscriptTurn,
  browserTranscriptToCallRecord,
  type CallRecord,
  scenarioRunIdForConversation,
} from "./call-record.ts";
import type { VoiceSessionTokenPayload } from "./voice-session-token.payload.ts";
import type { VoiceSessionFinishResult, VoiceSessionMintResult } from "./voice-session.schemas.ts";
import {
  type ElevenLabsCredential,
  type VoiceTransportCredential,
  type VoiceTransportRunner,
} from "./voice-transport.registry.ts";
import type { VoiceTransport } from "./voice-transport.ts";

/** The project has no key for this transport, so no session can be minted. */
export class VoiceKeyMissingError extends HandledError {
  declare readonly code: "voice_key_missing";
  constructor(message: string) {
    super("voice_key_missing", message, { httpStatus: 400 });
    this.name = "VoiceKeyMissingError";
  }
}

/** A run cannot be created for an unsaved agent without a name to save it
 *  under. The panel collects one and retries. */
export class VoiceNameRequiredError extends HandledError {
  declare readonly code: "voice_name_required";
  constructor() {
    super("voice_name_required", "A name is required to save the agent", {
      httpStatus: 400,
    });
    this.name = "VoiceNameRequiredError";
  }
}

/** The provider refused the mint (bad agent id, network, API error). */
export class VoiceMintFailedError extends HandledError {
  declare readonly code: "voice_mint_failed";
  constructor(message: string) {
    super("voice_mint_failed", message, { httpStatus: 400 });
    this.name = "VoiceMintFailedError";
  }
}

/**
 * The finished conversation ran against a different vendor agent than the
 * session token was minted for. Reported without writing anything, so one
 * project cannot pull another's conversation into its runs.
 */
export class VoiceConversationMismatchError extends HandledError {
  declare readonly code: "voice_conversation_mismatch";
  constructor() {
    super(
      "voice_conversation_mismatch",
      "This conversation does not belong to the minted session",
      { httpStatus: 400 },
    );
    this.name = "VoiceConversationMismatchError";
  }
}

/**
 * The mint request named an agent row that does not exist in this project, or
 * exists but is not a voice agent. Minting never trusts a client-supplied
 * vendor agent id (AC13/AC29) — the row is the only source of it.
 */
export class VoiceAgentRowNotFoundError extends HandledError {
  declare readonly code: "agent_not_found";
  constructor() {
    super("agent_not_found", "The voice agent was not found in this project", {
      httpStatus: 404,
    });
    this.name = "VoiceAgentRowNotFoundError";
  }
}

/**
 * A "Call it myself" finish named a scenario that no longer resolves to a
 * set: archived, removed, or another project's. Nothing is written rather
 * than silently downgrading to an unjudged drawer call (#8019).
 */
export class VoiceScenarioNotFoundError extends HandledError {
  declare readonly code: "scenario_not_found";
  constructor() {
    super("scenario_not_found", "The scenario was not found in this project", {
      httpStatus: 404,
    });
    this.name = "VoiceScenarioNotFoundError";
  }
}

/** The session token failed verification, or was minted for another project. */
export class VoiceSessionInvalidError extends HandledError {
  declare readonly code: "voice_session_invalid";
  constructor() {
    super("voice_session_invalid", "The session is invalid or has expired", {
      httpStatus: 400,
    });
    this.name = "VoiceSessionInvalidError";
  }
}

/** No live auth session behind a voice request. */
export class VoiceUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";
  constructor() {
    super("unauthorized", "Sign in to continue", { httpStatus: 401 });
    this.name = "VoiceUnauthenticatedError";
  }
}

/**
 * The whole "Talk to it" door is behind the product flag: a project without it
 * turned on gets the same 404 the drawer and the run dialog render for, not a
 * 403 that would leak that the door exists at all (AC29).
 */
export class VoiceAgentsGateDisabledError extends HandledError {
  declare readonly code: "voice_agents_disabled";
  constructor() {
    super("voice_agents_disabled", VOICE_AGENTS_DISABLED_MESSAGE, {
      httpStatus: 404,
    });
    this.name = "VoiceAgentsGateDisabledError";
  }
}

/**
 * The audio proxy found no run for this conversation, or the provider had
 * nothing to stream back. Kept 404, not 400, matching the flag-off and
 * row-not-found responses on the same door.
 */
export class VoiceRecordingUnavailableError extends HandledError {
  declare readonly code: "voice_recording_unavailable";
  constructor() {
    super("voice_recording_unavailable", "The call recording is not available", {
      httpStatus: 404,
    });
    this.name = "VoiceRecordingUnavailableError";
  }
}

/** The audio proxy has no provider key to fetch the recording with. */
export class VoiceRecordingKeyMissingError extends HandledError {
  declare readonly code: "voice_recording_key_missing";
  constructor() {
    super("voice_recording_key_missing", "The call recording is not available", {
      httpStatus: 404,
    });
    this.name = "VoiceRecordingKeyMissingError";
  }
}

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
  findExistingRun(input: { projectId: string; scenarioRunId: string }): Promise<{
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
  } | null>;
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

/** Extra grace beyond the call budget before a session token expires: a call
 *  runs at most the budget, and finish arrives soon after. */
export const VOICE_SESSION_TOKEN_GRACE_MS = 10 * 60 * 1000;

// Ask transport for signed URL. Vendor agent id from saved row if present; from request if draft.
// Throws VoiceAgentRowNotFoundError, VoiceKeyMissingError, or VoiceMintFailedError.
export async function mintVoiceSession({
  ports,
  projectId,
  transport,
  agentId: bodyAgentId,
  agentRowId,
  maxDurationSeconds,
}: {
  ports: VoiceSessionInfrastructure;
  projectId: string;
  transport: VoiceTransport;
  /** The vendor agent id from the form. Used only when there is no saved
   *  row yet — a saved row's own vendor id always wins. */
  agentId: string;
  /** The saved agent row id, when the drawer already has one. */
  agentRowId?: string;
  maxDurationSeconds: number;
}): Promise<VoiceSessionMintResult> {
  const row = agentRowId ? await ports.getVoiceAgentRow({ projectId, agentRowId }) : undefined;
  const agentId = row?.agentExternalId ?? bodyAgentId;

  const runner = runnerFor(ports, transport);
  runner.assertAvailable?.();
  const credential = await ports.getCredential({ projectId, transport });

  let connect: { signedUrl: string };
  try {
    connect = await runner.mintSession({ agentId, credential });
  } catch (error) {
    throw new VoiceMintFailedError(error instanceof Error ? error.message : String(error));
  }

  // The token binds the call to its project, the row (when one exists) and
  // the vendor agent for the whole of its life plus a grace window; finish
  // rejects anything outside these claims.
  const sessionToken = ports.signSessionToken({
    sessionId: ports.newSessionId(),
    projectId,
    agentId: row?.id ?? null,
    agentExternalId: agentId,
    transport,
    exp: ports.now() + maxDurationSeconds * 1000 + VOICE_SESSION_TOKEN_GRACE_MS,
  });

  return {
    transport,
    sessionToken,
    maxDurationSeconds,
    connect,
  };
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

type ExistingRun = NonNullable<Awaited<ReturnType<VoiceSessionInfrastructure["findExistingRun"]>>>;

/**
 * The result for a terminal run returned untouched: a duplicate finish
 * writes nothing (AC14, #7973 AC1). The scenario is deliberately not
 * re-resolved, so an archived scenario cannot break the retry (#7973 AC1).
 */
function terminalRunResult({
  scenarioRunId,
  token,
  existing,
}: {
  scenarioRunId: string;
  token: VoiceSessionTokenPayload;
  existing: ExistingRun;
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
function assertProviderRecordMatchesToken(
  providerRecord: CallRecord | null,
  token: VoiceSessionTokenPayload,
): void {
  if (providerRecord && providerRecord.agentExternalId !== token.agentExternalId) {
    throw new VoiceConversationMismatchError();
  }
}

// Record to write: provider's when it holds turns, else browser transcript.
// Provider with empty turns loses conversation; prefer browser to avoid "no response" (#8019).
function selectCallRecord({
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
const WRITTEN_STATUSES: ReadonlySet<ScenarioRunStatus> = new Set([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
]);
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
export async function finishVoiceSession(input: {
  ports: VoiceSessionInfrastructure;
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
}): Promise<VoiceSessionFinishResult> {
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

// Whether drawer call's recording belongs to this project. Drawer call not persisted (#8020), so
// check provider agent against saved agents.
async function drawerRecordingBelongsToProject(
  ports: VoiceSessionInfrastructure,
  {
    projectId,
    transport,
    conversationId,
    credential,
  }: {
    projectId: string;
    transport: VoiceTransport;
    conversationId: string;
    credential: VoiceTransportCredential;
  },
): Promise<boolean> {
  let record: CallRecord;
  try {
    record = await runnerFor(ports, transport).getCallRecord({
      conversationId,
      credential,
      audioProxyUrl: ports.audioProxyUrl({ conversationId, projectId }),
    });
  } catch {
    return false;
  }
  const agentExternalId = record.agentExternalId;
  if (!agentExternalId) return false;
  return ports.hasVoiceAgentForExternalId({
    projectId,
    transport,
    agentExternalId,
  });
}

// Authorize recording playback and return provider credential. Scenario runs authorize directly;
// drawer calls (#8020) authorized only if conversation ran against saved voice agent.
export async function authorizeRecordingPlayback({
  ports,
  projectId,
  conversationId,
}: {
  ports: VoiceSessionInfrastructure;
  projectId: string;
  conversationId: string;
}): Promise<ElevenLabsCredential> {
  const transport: VoiceTransport = "elevenlabs_convai";
  const existing = await ports.findExistingRun({
    projectId,
    scenarioRunId: scenarioRunIdForConversation(conversationId),
  });

  let credential: VoiceTransportCredential;
  try {
    credential = await ports.getCredential({ projectId, transport });
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === "voice_key_missing") {
      throw new VoiceRecordingKeyMissingError();
    }
    throw error;
  }
  // Recording playback only exists for ElevenLabs conversations; a credential
  // of another kind reaching here is a wiring bug (transport is hardcoded
  // above), not a customer-facing failure.
  if (credential.kind !== "elevenlabs") {
    throw new Error("Recording playback is only available for ElevenLabs conversations");
  }

  // A scenario run authorizes playback directly; no provider call needed.
  if (existing) return credential;

  // No run was written (a drawer call, #8020): authorize only when the provider
  // conversation ran against a voice agent this project actually saved.
  const allowed = await drawerRecordingBelongsToProject(ports, {
    projectId,
    transport,
    conversationId,
    credential,
  });
  if (!allowed) throw new VoiceRecordingUnavailableError();
  return credential;
}
