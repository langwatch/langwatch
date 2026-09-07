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

import type { VoiceTransport } from "~/server/agents/voice/voice-agent.config";
import {
  type BrowserTranscriptTurn,
  browserTranscriptToCallRecord,
  type CallRecord,
  scenarioRunIdForConversation,
} from "./call-record";
import {
  type VoiceTransportCredential,
  type VoiceTransportRunner,
  voiceTransportRegistry,
} from "./voice-transport.registry";

/** The project has no key for this transport, so no session can be minted. */
export class VoiceKeyMissingError extends Error {
  readonly code = "voice_key_missing" as const;
  constructor(message: string) {
    super(message);
    this.name = "VoiceKeyMissingError";
  }
}

/** A run cannot be created for an unsaved agent without a name to save it
 *  under. The panel collects one and retries. */
export class VoiceNameRequiredError extends Error {
  readonly code = "voice_name_required" as const;
  constructor() {
    super("A name is required to save the agent");
    this.name = "VoiceNameRequiredError";
  }
}

/** The provider refused the mint (bad agent id, network, API error). */
export class VoiceMintFailedError extends Error {
  readonly code = "voice_mint_failed" as const;
  constructor(message: string) {
    super(message);
    this.name = "VoiceMintFailedError";
  }
}

export interface VoiceSessionPorts {
  /** The provider key and host for this project's transport, or null. */
  resolveCredential(input: {
    projectId: string;
    transport: VoiceTransport;
  }): Promise<VoiceTransportCredential | null>;
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
  /** Write the call down as a run the results pages render. */
  writeCallRun(input: {
    projectId: string;
    scenarioRunId: string;
    agentRowId: string;
    agentDisplayName: string;
    record: CallRecord;
  }): Promise<void>;
  /** Same-origin proxy path the browser plays the recording through. */
  audioProxyUrl(input: { conversationId: string }): string;
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

export interface MintResult {
  transport: VoiceTransport;
  /** Our correlation id for the call until the provider assigns one. Also the
   *  conversation id the browser reports back if the provider gives it none. */
  sessionId: string;
  maxDurationSeconds: number;
  connect: { signedUrl: string };
}

/**
 * Ask the transport for a signed URL and return only what the browser needs to
 * open the call. No key crosses this boundary. Throws
 * {@link VoiceKeyMissingError} when the project has no key, or
 * {@link VoiceMintFailedError} when the provider refuses.
 */
export async function mintVoiceSession(
  ports: VoiceSessionPorts,
  {
    projectId,
    transport,
    agentId,
    maxDurationSeconds,
  }: {
    projectId: string;
    transport: VoiceTransport;
    agentId: string;
    maxDurationSeconds: number;
  },
): Promise<MintResult> {
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

  return {
    transport,
    sessionId: ports.newSessionId(),
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
  fetchFailed: boolean;
  hasAudio: boolean;
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
    projectId: string;
    transport: VoiceTransport;
    agentId: string;
    agentRowId?: string;
    name?: string;
    transcript: BrowserTranscriptTurn[];
    startedAt: number;
    endedAt: number;
    cutAtLimit: boolean;
    conversationId?: string;
    sessionId: string;
  },
): Promise<FinishResult> {
  const conversationId = input.conversationId?.trim() || input.sessionId;
  const scenarioRunId = scenarioRunIdForConversation(conversationId);

  const existing = await ports.findExistingRun({
    projectId: input.projectId,
    scenarioRunId,
  });
  if (existing) {
    return {
      runId: scenarioRunId,
      agentId: input.agentRowId ?? existing.agentId ?? "",
      source: "provider",
      fetchFailed: false,
      hasAudio: false,
    };
  }

  // Resolve the agent row: reuse the one the drawer saved, else create it now.
  // A create needs a name; without one the panel collects it and retries.
  let agentRowId = input.agentRowId;
  let agentDisplayName = input.name?.trim() ?? "";
  if (!agentRowId) {
    if (!agentDisplayName) throw new VoiceNameRequiredError();
    const created = await ports.createVoiceAgent({
      projectId: input.projectId,
      name: agentDisplayName,
      transport: input.transport,
      agentId: input.agentId,
    });
    agentRowId = created.id;
  }
  if (!agentDisplayName) agentDisplayName = input.agentId;

  // Prefer the provider's record; fall back to the live transcript when it is
  // not ready (null) or the fetch fails (throws).
  const runner = runnerFor(ports, input.transport);
  const credential = await ports.resolveCredential({
    projectId: input.projectId,
    transport: input.transport,
  });
  let record: CallRecord | null = null;
  let fetchFailed = false;
  if (credential) {
    try {
      record = await runner.fetchCallRecord({
        conversationId,
        credential,
        audioProxyUrl: ports.audioProxyUrl({ conversationId }),
      });
    } catch {
      fetchFailed = true;
    }
  }

  if (record) {
    record.cutAtLimit = input.cutAtLimit;
  } else {
    record = browserTranscriptToCallRecord({
      conversationId,
      transport: input.transport,
      transcript: input.transcript,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      cutAtLimit: input.cutAtLimit,
    });
  }

  await ports.writeCallRun({
    projectId: input.projectId,
    scenarioRunId,
    agentRowId,
    agentDisplayName,
    record,
  });

  return {
    runId: scenarioRunId,
    agentId: agentRowId,
    source: record.source,
    fetchFailed,
    hasAudio: Boolean(record.audioUrl),
  };
}
