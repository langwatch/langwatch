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
  /** The run already written for this id, or null. Returns the agent id it
   *  attached so a duplicate finish can answer with it. */
  findExistingRun(input: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<{ agentId: string | null } | null>;
  /** Create the voice agent row on hang-up when the drawer had none yet. */
  createVoiceAgent(input: {
    projectId: string;
    name: string;
    transport: VoiceTransport;
    agentId: string;
  }): Promise<{ id: string }>;
  /** Write the call down as a run the results pages render. When `scenario`
   *  is given the run lands under that scenario (a "Call it myself" run);
   *  otherwise it lands in the voice-call set (a drawer call). */
  writeCallRun(input: {
    projectId: string;
    scenarioRunId: string;
    agentRowId: string;
    agentDisplayName: string;
    record: CallRecord;
    scenario?: { scenarioId: string; scenarioSetId: string };
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
export async function mintVoiceSession(
  ports: VoiceSessionPorts,
  {
    projectId,
    transport,
    agentId: bodyAgentId,
    agentRowId,
    maxDurationSeconds,
  }: {
    projectId: string;
    transport: VoiceTransport;
    /** The vendor agent id from the form. Used only when there is no saved
     *  row yet — a saved row's own vendor id always wins. */
    agentId: string;
    /** The saved agent row id, when the drawer already has one. */
    agentRowId?: string;
    maxDurationSeconds: number;
  },
): Promise<MintResult> {
  const row = agentRowId
    ? await ports.resolveVoiceAgentRow({ projectId, agentRowId })
    : null;
  if (agentRowId && !row) throw new VoiceAgentRowNotFoundError();
  const agentId = row?.agentExternalId ?? bodyAgentId;

  const runner = runnerFor(ports, transport);
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
  const credential = await ports.resolveCredential({ projectId, transport });
  if (!credential) return { record: null, hasFetchFailed: false };
  try {
    const record = await runnerFor(ports, transport).fetchCallRecord({
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
  }: {
    token: VoiceSessionTokenPayload;
    projectId: string;
    transport: VoiceTransport;
    name?: string;
  },
): Promise<{ agentRowId: string; agentDisplayName: string }> {
  const trimmedName = name?.trim() ?? "";
  if (token.agentId) {
    return {
      agentRowId: token.agentId,
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
 * shares with that scenario's simulated runs (AC23). Undefined for a drawer
 * call, or when the named scenario is gone.
 */
async function resolveScenarioContext(
  ports: VoiceSessionPorts,
  { projectId, scenarioId }: { projectId: string; scenarioId?: string },
): Promise<{ scenarioId: string; scenarioSetId: string } | undefined> {
  if (!scenarioId) return undefined;
  const scenario = await ports.resolveScenarioSet?.({ projectId, scenarioId });
  if (!scenario) return undefined;
  return { scenarioId, scenarioSetId: scenario.scenarioSetId };
}

/**
 * Ingest a finished call as a run, exactly once per conversation.
 *
 * Idempotent on the conversation id: a second hang-up, a mid-call reload or a
 * late webhook all resolve to the same run id, and an existing run is returned
 * untouched (AC14). Creates the agent row when the drawer had none; falls back
 * to the live transcript when the provider record is not ready or the fetch
 * fails, marking the latter so the panel can say so (AC15).
 */
export async function finishVoiceSession(
  ports: VoiceSessionPorts,
  input: {
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
     *  (AC23). Absent for a drawer call. */
    scenarioId?: string;
  },
): Promise<FinishResult> {
  const { token } = input;
  const transport = token.transport;
  const conversationId = input.conversationId?.trim() || token.sessionId;
  const scenarioRunId = scenarioRunIdForConversation(conversationId);

  const scenarioContext = await resolveScenarioContext(ports, {
    projectId: input.projectId,
    scenarioId: input.scenarioId,
  });

  const existing = await ports.findExistingRun({
    projectId: input.projectId,
    scenarioRunId,
  });
  if (existing) {
    return {
      runId: scenarioRunId,
      agentId: token.agentId ?? existing.agentId ?? "",
      source: "provider",
      hasFetchFailed: false,
      hasAudio: false,
      scenarioSetId: scenarioContext?.scenarioSetId,
    };
  }

  // Prefer the provider's record; fall back to the live transcript when it is
  // not ready or the fetch fails. Fetched BEFORE the agent row is created so a
  // mismatched conversation is rejected without leaving an orphan agent behind.
  const { record: providerRecord, hasFetchFailed } = await fetchProviderRecord(
    ports,
    { transport, conversationId, projectId: input.projectId },
  );

  // A provider record must have run against the very agent the token was minted
  // for. Anything else — including a record with no agent id at all — is a
  // conversation this session has no claim to, and nothing is written (AC13).
  if (
    providerRecord &&
    providerRecord.agentExternalId !== token.agentExternalId
  ) {
    throw new VoiceConversationMismatchError();
  }

  const { agentRowId, agentDisplayName } = await resolveAgentRow(ports, {
    token,
    projectId: input.projectId,
    transport,
    name: input.name,
  });

  const record = providerRecord
    ? { ...providerRecord, isCutAtLimit: input.isCutAtLimit }
    : browserTranscriptToCallRecord({
        conversationId,
        transport,
        transcript: input.transcript,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        isCutAtLimit: input.isCutAtLimit,
      });

  await ports.writeCallRun({
    projectId: input.projectId,
    scenarioRunId,
    agentRowId,
    agentDisplayName,
    record,
    ...(scenarioContext ? { scenario: scenarioContext } : {}),
  });

  return {
    runId: scenarioRunId,
    agentId: agentRowId,
    source: record.source,
    hasFetchFailed,
    hasAudio: Boolean(record.audioUrl),
    audioUrl: record.audioUrl,
    scenarioSetId: scenarioContext?.scenarioSetId,
  };
}
