import { HandledError } from "@langwatch/handled-error";
import {
  VoiceRecordingKeyMissingError,
  VoiceRecordingUnavailableError,
  type CallRecord,
  type VoiceTransport,
} from "@langwatch/scenario-contract";

import type {
  ElevenLabsCredential,
  VoiceTransportCredential,
} from "../../../channels/voice-transport.channel.ts";
import { scenarioRunIdForConversation } from "../../../rules/voice-call-record.rules.ts";
import type { VoiceCallPlaybackInput, VoiceSessionInfrastructure } from "./voice-call.service.ts";

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
    record = await ports.registry[transport].getCallRecord({
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
async function authorizeRecordingPlayback({
  ports,
  projectId,
  conversationId,
}: VoiceCallPlaybackInput & { ports: VoiceSessionInfrastructure }): Promise<ElevenLabsCredential> {
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

/** Gates recording playback behind the project that owns the conversation. */
export class VoiceCallPlaybackService {
  static create(ports: VoiceSessionInfrastructure): VoiceCallPlaybackService {
    return new VoiceCallPlaybackService(ports);
  }

  private constructor(private readonly ports: VoiceSessionInfrastructure) {}

  authorizeRecordingPlayback(input: VoiceCallPlaybackInput): Promise<ElevenLabsCredential> {
    return authorizeRecordingPlayback({ ...input, ports: this.ports });
  }
}
