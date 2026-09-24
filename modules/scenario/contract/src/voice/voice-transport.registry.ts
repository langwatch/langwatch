// Registry of voice transports: one interface per transport. Vendors stay inside transports/.

import type { AgentAdapter } from "@langwatch/scenario";

import type { CallRecord } from "./call-record.ts";
import { elevenLabsConvaiTransport } from "./transports/elevenlabs-convai.transport.ts";
import {
  createPhoneTransport,
  type PhoneTransportEnvironment,
} from "./transports/phone.transport.ts";
import type { VoiceTransport } from "./voice-transport.ts";

// Credential for reading/dialing. Never reaches browser (stays with runner).
// Discriminated union: ElevenLabs (key + host) vs Twilio (SID + token + number).
export type VoiceTransportCredential =
  | { kind: "elevenlabs"; apiKey: string; baseUrl: string }
  | {
      kind: "twilio";
      accountSid: string;
      authToken: string;
      fromNumber: string;
    };

/** The ElevenLabs branch of {@link VoiceTransportCredential}, narrowed for
 *  callers that only ever handle ElevenLabs conversations (recording
 *  playback has no meaning for a phone target). */
export type ElevenLabsCredential = Extract<VoiceTransportCredential, { kind: "elevenlabs" }>;

/** What a minted browser session needs to open the call, minus the id and
 *  limit the service adds. The signed URL is short-lived and safe to hand out;
 *  the key is not, and never appears here. */
export interface VoiceSessionConnect {
  signedUrl: string;
}

export interface VoiceTransportRunner {
  // Guard before browser-driven mint/record. Phone throws; doesn't gate headless dial.
  assertAvailable?(): void;
  /** Build the SDK agent adapter the pool child drives for this transport. */
  createAgentAdapter(input: {
    agentId: string;
    credential: VoiceTransportCredential;
    maxCallSeconds: number;
  }): AgentAdapter;
  /**
   * Ask the provider for a short-lived signed URL the browser opens the call
   * with. The key stays here; only the signed URL travels back.
   */
  mintSession: (input: {
    agentId: string;
    credential: VoiceTransportCredential;
  }) => Promise<VoiceSessionConnect>;
  /**
   * Read the finished conversation back as a normalised `CallRecord`. No record
   * yet throws `voice_call_record_not_ready` (the browser transcript is kept);
   * any other throw is a failed fetch (AC15).
   */
  getCallRecord(input: {
    conversationId: string;
    credential: VoiceTransportCredential;
    audioProxyUrl: string;
  }): Promise<CallRecord>;
  /**
   * End the live call now, when the whole-call limit elapses, so the
   * drained transcript is still judged (AC28). "Hang up" lives on the runner
   * contract, not cast at the call site, so a later transport ends it its own way.
   */
  endCall(adapter: AgentAdapter): Promise<void>;
  /** Customer-facing failure when the project has no key for this transport. */
  readonly missingKeyMessage: string;
}

export function createVoiceTransportRegistry(
  environment: PhoneTransportEnvironment,
): Record<VoiceTransport, VoiceTransportRunner> {
  return {
    elevenlabs_convai: elevenLabsConvaiTransport,
    phone: createPhoneTransport({ environment }),
  };
}
