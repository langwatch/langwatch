import { VoiceMintFailedError, type VoiceSessionMintResult } from "@langwatch/scenario-contract";

import type { VoiceCallMintInput, VoiceSessionInfrastructure } from "./voice-call.service.ts";

/** Extra grace beyond the call budget before a session token expires: a call
 *  runs at most the budget, and finish arrives soon after. */
const VOICE_SESSION_TOKEN_GRACE_MS = 10 * 60 * 1000;

// Ask transport for signed URL. Vendor agent id from saved row if present; from request if draft.
// Throws VoiceAgentRowNotFoundError, VoiceKeyMissingError, or VoiceMintFailedError.
async function mintVoiceSession({
  ports,
  projectId,
  transport,
  agentId: bodyAgentId,
  agentRowId,
  maxDurationSeconds,
}: VoiceCallMintInput & { ports: VoiceSessionInfrastructure }): Promise<VoiceSessionMintResult> {
  const row = agentRowId ? await ports.getVoiceAgentRow({ projectId, agentRowId }) : undefined;
  const agentId = row?.agentExternalId ?? bodyAgentId;

  const runner = ports.registry[transport];
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

/** Mints the signed browser session for a voice call. */
export class VoiceCallMintService {
  static create(ports: VoiceSessionInfrastructure): VoiceCallMintService {
    return new VoiceCallMintService(ports);
  }

  private constructor(private readonly ports: VoiceSessionInfrastructure) {}

  mint(input: VoiceCallMintInput): Promise<VoiceSessionMintResult> {
    return mintVoiceSession({ ...input, ports: this.ports });
  }
}
