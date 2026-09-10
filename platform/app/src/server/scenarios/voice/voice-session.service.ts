/**
 * The service behind "Talk to it": mint a browser call session, and ingest the
 * finished call as a run.
 *
 * Written against injected ports (credential lookup, run existence, agent
 * creation, run writer, clock, id) so the orchestration — no-key refusal,
 * idempotent ingestion, agent auto-create, provider-vs-browser record — is
 * unit-tested with fakes and the route wires the real ones. Nothing here names
 * a vendor: the transport does, behind {@link voiceTransportRegistry}.
 */

import { HandledError } from "@langwatch/handled-error";

import type { VoiceTransport } from "~/server/agents/voice/voice-agent.config";
import { VOICE_AGENTS_DISABLED_MESSAGE } from "~/server/featureFlag/voiceAgents.message";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import {
  type BrowserTranscriptTurn,
  browserTranscriptToCallRecord,
  type CallRecord,
  scenarioRunIdForConversation,
} from "./call-record";
import type { VoiceSessionTokenPayload } from "./voice-session-token";
import {
  type VoiceTransportCredential,
  type VoiceTransportRunner,
  voiceTransportRegistry,
} from "./voice-transport.registry";

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
 * A "Call it myself" finish named a scenario that no longer resolves to a set:
 * archived, removed, or from another project. A human call can only be scored
 * against a real scenario, so nothing is written rather than silently
 * downgrading the run to an unjudged drawer call (#8019).
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
 * The audio proxy found no run for this conversation in the project, or the
 * provider had nothing to stream back. Kept 404 (not 400) so it reads like
 * the resource itself is missing, matching the flag-off and row-not-found
 * responses on the same door.
 */
export class VoiceRecordingUnavailableError extends HandledError {
  declare readonly code: "voice_recording_unavailable";
  constructor() {
    super(
      "voice_recording_unavailable",
      "The call recording is not available",
      {
        httpStatus: 404,
      },
    );
    this.name = "VoiceRecordingUnavailableError";
  }
}

/** The audio proxy has no provider key to fetch the recording with. */
export class VoiceRecordingKeyMissingError extends HandledError {
  declare readonly code: "voice_recording_key_missing";
  constructor() {
    super(
      "voice_recording_key_missing",
      "The call recording is not available",
      { httpStatus: 404 },
    );
    this.name = "VoiceRecordingKeyMissingError";
  }
}

export interface VoiceSessionPorts {
  /** The provider key and host for this project's transport, or null. */
  resolveCredential(input: {
    projectId: string;
    transport: VoiceTransport;
  }): Promise<VoiceTransportCredential | null>;
  /** The vendor agent id stored on the project's voice agent row, or null
   *  when the row does not exist or is not type "voice". This — never the
   *  request body — is what a mint is minted against. */
  resolveVoiceAgentRow(input: {
    projectId: string;
    agentRowId: string;
  }): Promise<{ id: string; agentExternalId: string } | null>;
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
  }): Promise<{
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
   *  lands beside that scenario's simulated runs. Null when the scenario is
   *  gone. Absent when the deployment never runs scenario calls. */
  resolveScenarioSet?(input: {
    projectId: string;
    scenarioId: string;
  }): Promise<{ scenarioSetId: string } | null>;
  /** Same-origin proxy path the browser plays the recording through. Carries
   *  the project so the proxy can authorise the fetch. */
  audioProxyUrl(input: { conversationId: string; projectId: string }): string;
  /** Sign the session claims into the token the browser carries mint→finish. */
  signSessionToken(payload: VoiceSessionTokenPayload): string;
  now(): number;
  newSessionId(): string;
  registry?: Record<VoiceTransport, VoiceTransportRunner>;
}

function runnerFor(
  ports: VoiceSessionPorts,
  transport: VoiceTransport,
): VoiceTransportRunner {
  return (ports.registry ?? voiceTransportRegistry)[transport];
}

/** Extra grace beyond the call budget before a session token expires: a call
 *  runs at most the budget, and finish arrives soon after. */
export const VOICE_SESSION_TOKEN_GRACE_MS = 10 * 60 * 1000;

export interface MintResult {
  transport: VoiceTransport;
  /** The signed session token binding this call to its project and agent. The
   *  browser carries it back to finish; it replaces the bare id and never
   *  carries the provider key. */
  sessionToken: string;
  maxDurationSeconds: number;
  connect: { signedUrl: string };
}

/**
 * Ask the transport for a signed URL and return only what the browser needs to
 * open the call. When the drawer already has a saved agent row, the vendor
 * agent id is read off that row rather than trusted from the request, so a
 * mint against a saved agent can only ever open a call against the agent this
 * project actually saved there (AC13/AC29). When there is no row yet (an
 * unsaved draft — AC5's "Talk to it without saving first"), the vendor id
 * comes from the request body, exactly as before mint had a row to check
 * against; the row itself is created at finish. Throws
 * {@link VoiceAgentRowNotFoundError} when a named row is missing or not a
 * voice agent, {@link VoiceKeyMissingError} when the project has no key, or
 * {@link VoiceMintFailedError} when the provider refuses.
 */
export async function mintVoiceSession({
  ports,
  projectId,
  transport,
  agentId: bodyAgentId,
  agentRowId,
  maxDurationSeconds,
}: {
  ports: VoiceSessionPorts;
  projectId: string;
  transport: VoiceTransport;
  /** The vendor agent id from the form. Used only when there is no saved
   *  row yet — a saved row's own vendor id always wins. */
  agentId: string;
  /** The saved agent row id, when the drawer already has one. */
  agentRowId?: string;
  maxDurationSeconds: number;
}): Promise<MintResult> {
  const row = agentRowId
    ? await ports.resolveVoiceAgentRow({ projectId, agentRowId })
    : null;
  if (agentRowId && !row) throw new VoiceAgentRowNotFoundError();
  const agentId = row?.agentExternalId ?? bodyAgentId;

  const runner = runnerFor(ports, transport);
  runner.assertAvailable?.();
  const credential = await ports.resolveCredential({ projectId, transport });
  if (!credential) throw new VoiceKeyMissingError(runner.missingKeyMessage);

  let connect: { signedUrl: string };
  try {
    connect = await runner.mintSession({ agentId, credential });
  } catch (error) {
    throw new VoiceMintFailedError(
      error instanceof Error ? error.message : String(error),
    );
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

export interface FinishResult {
  runId: string;
  agentId: string;
  /** Where the run's turns came from. */
  source: CallRecord["source"];
  /** True only when the provider fetch itself errored (not "not ready yet"):
   *  the panel shows the fetch-failed notice (AC15). */
  hasFetchFailed: boolean;
  hasAudio: boolean;
  /** The same-origin proxy URL the panel plays the recording through, when the
   *  provider returned audio. Absent otherwise, and the panel renders no
   *  player. */
  audioUrl?: string;
  /** The set the run landed in, so the panel links to it. Set only for a
   *  "Call it myself" run written under a scenario. */
  scenarioSetId?: string;
}

/**
 * Read the provider's record for a conversation, or fall back. Returns the
 * record (null when the provider has none yet or there is no key) and whether
 * the fetch itself failed (as opposed to "not ready"), so the caller can mark
 * the fetch-failed notice (AC15).
 */
async function fetchProviderRecord(
  ports: VoiceSessionPorts,
  {
    transport,
    conversationId,
    projectId,
  }: { transport: VoiceTransport; conversationId: string; projectId: string },
): Promise<{ record: CallRecord | null; hasFetchFailed: boolean }> {
  const runner = runnerFor(ports, transport);
  runner.assertAvailable?.();
  const credential = await ports.resolveCredential({ projectId, transport });
  if (!credential) return { record: null, hasFetchFailed: false };
  try {
    const record = await runner.fetchCallRecord({
      conversationId,
      credential,
      audioProxyUrl: ports.audioProxyUrl({ conversationId, projectId }),
    });
    return { record, hasFetchFailed: false };
  } catch {
    return { record: null, hasFetchFailed: true };
  }
}

/**
 * Resolve the agent row the run is written under: reuse the one the token
 * carries, else create it from the form values. A create needs a name; without
 * one the panel collects it and retries (throws {@link VoiceNameRequiredError}).
 */
async function resolveAgentRow(
  ports: VoiceSessionPorts,
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
 * Resolve the scenario a "Call it myself" run is written under and the set it
 * shares with that scenario's simulated runs (AC23). A named scenario that
 * cannot be resolved throws {@link VoiceScenarioNotFoundError}: writing it as
 * an unscored run would lose the verdict the caller asked for (#8019). Called
 * only on the scenario branch, so `scenarioId` is always present.
 */
async function resolveScenarioContext(
  ports: VoiceSessionPorts,
  { projectId, scenarioId }: { projectId: string; scenarioId: string },
): Promise<{ scenarioId: string; scenarioSetId: string }> {
  const scenario = await ports.resolveScenarioSet?.({ projectId, scenarioId });
  if (!scenario) throw new VoiceScenarioNotFoundError();
  return { scenarioId, scenarioSetId: scenario.scenarioSetId };
}

type ExistingRun = NonNullable<
  Awaited<ReturnType<VoiceSessionPorts["findExistingRun"]>>
>;

/**
 * The result for a terminal run returned untouched: a duplicate finish writes
 * nothing (AC14, #7973 AC1). The agent id comes from the token when it names
 * one, else from the run that already landed; the transcript source, recording
 * and scenario set all come from that run, so a retry keeps the Play control
 * and the deep link to the set (AC14) — the scenario is deliberately not
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
}): FinishResult {
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
  if (
    providerRecord &&
    providerRecord.agentExternalId !== token.agentExternalId
  ) {
    throw new VoiceConversationMismatchError();
  }
}

/**
 * The record the run is written from: the provider's when it holds turns, else
 * the browser transcript.
 *
 * A provider record with no turns loses the conversation: right after hang-up
 * ElevenLabs can answer with a finished-looking record whose transcript is
 * still empty. When the browser captured turns, keep them rather than write an
 * empty run the reader sees as "no response" (#8019).
 */
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
      ...(providerRecord?.audioUrl
        ? { audioUrl: providerRecord.audioUrl }
        : {}),
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
 * The shared tail of a finished call: read the provider record (or fall back to
 * the live transcript), reject a conversation the token has no claim to,
 * resolve the agent row and record one trace per exchange. Returns the record
 * and agent id both branches build their result from. A drawer call runs only
 * this much; a scenario call goes on to write the run.
 */
async function ingestFinishedCall(
  input: {
    ports: VoiceSessionPorts;
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
  const { record: providerRecord, hasFetchFailed } = await fetchProviderRecord(
    ports,
    { transport, conversationId, projectId: input.projectId },
  );

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

/**
 * Finish a drawer "Talk to it" call. Every browser call records one trace per
 * exchange (3a), which is where the transcript and recording live; a drawer
 * call is scored against no scenario, so it is NOT written as a run (#8020).
 * Writing it as a SUCCESS run with no verdict is exactly the forever-"the judge
 * is reading the conversation" state this issue removes. The agent row is still
 * created on first hang-up (unrelated to run-writing, decision 3), deduped by
 * its identity key so a retried finish for a not-yet-saved agent reuses the
 * same row rather than creating a second one (decision 1).
 */
async function finishDrawerCall(
  input: {
    ports: VoiceSessionPorts;
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
): Promise<FinishResult> {
  const { record, hasFetchFailed, agentRowId } = await ingestFinishedCall(
    input,
    { transport, conversationId, scenarioRunId },
  );

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

/**
 * Ingest a finished call.
 *
 * Two shapes, split on whether the call names a scenario:
 *  - A drawer "Talk to it" call (no scenario id) records its traces and returns;
 *    it is never written as a run (#8020). See {@link finishDrawerCall}.
 *  - A "Call it myself" call (a scenario id) is written as a run and judged,
 *    idempotently on the conversation id: a second hang-up, a mid-call reload or
 *    a late webhook all resolve to the same run id. A fully written run
 *    (SUCCESS/FAILED) is returned untouched (AC14, #7973 AC1); a half-written or
 *    cancelled run is re-driven through `writeCallRun` (#7973 AC2). Falls back to
 *    the live transcript when the provider record is not ready or the fetch
 *    fails, marking the latter so the panel can say so (AC15).
 */
export async function finishVoiceSession(input: {
  ports: VoiceSessionPorts;
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
}): Promise<FinishResult> {
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

  // A terminal run is complete: a duplicate finish returns it untouched (AC14,
  // #7973 AC1). A non-terminal run is half-written — startRun landed but a
  // snapshot or the finish write failed — so the retry re-drives writeCallRun
  // with the same scenarioRunId to complete it exactly once (#7973 AC2).
  //
  // Checked BEFORE resolving the scenario: a run that already finished must be
  // returned untouched even when its scenario has since been archived, so a
  // scenario lookup that would now throw scenario_not_found is never reached
  // (#7973 AC1).
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

/**
 * Whether a drawer call's recording belongs to this project. A drawer call is
 * never written as a run (#8020), so there is nothing to authorize its playback
 * against; instead the provider is asked which agent the conversation ran
 * against, and playback is allowed only when this project saved that voice
 * agent. A refused redirect, a not-yet-ready record or a fetch failure all read
 * the same way: not this project's to play. Traces are deliberately not
 * consulted, since a trace write goes through the ingest pipeline and can lag
 * the hang-up.
 */
async function drawerRecordingBelongsToProject(
  ports: VoiceSessionPorts,
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
  let record: CallRecord | null;
  try {
    record = await runnerFor(ports, transport).fetchCallRecord({
      conversationId,
      credential,
      audioProxyUrl: ports.audioProxyUrl({ conversationId, projectId }),
    });
  } catch {
    return false;
  }
  const agentExternalId = record?.agentExternalId;
  if (!agentExternalId) return false;
  return ports.hasVoiceAgentForExternalId({
    projectId,
    transport,
    agentExternalId,
  });
}

/**
 * Authorize a recording-playback request and return the provider credential the
 * route streams the audio with. A scenario "Call it myself" run authorizes
 * playback directly (a run for the conversation exists in this project). A
 * drawer call writes no run (#8020), so it is authorized only when the provider
 * conversation ran against a voice agent this project saved. Anything else
 * throws {@link VoiceRecordingUnavailableError}; the credential is returned only
 * on success, so it never leaks on a refusal. Throws
 * {@link VoiceRecordingKeyMissingError} when the project has no provider key.
 * Drawer calls only run on ElevenLabs today.
 */
export async function authorizeRecordingPlayback({
  ports,
  projectId,
  conversationId,
}: {
  ports: VoiceSessionPorts;
  projectId: string;
  conversationId: string;
}): Promise<VoiceTransportCredential> {
  const transport: VoiceTransport = "elevenlabs_convai";
  const existing = await ports.findExistingRun({
    projectId,
    scenarioRunId: scenarioRunIdForConversation(conversationId),
  });

  const credential = await ports.resolveCredential({ projectId, transport });
  if (!credential) throw new VoiceRecordingKeyMissingError();

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
