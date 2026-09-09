/**
 * Registry of voice transports: one server interface per transport, so a later
 * transport (phone) is a new entry here rather than a change to the adapter or
 * the child. Nothing outside `transports/` names a vendor — a runner is opaque
 * behind this interface.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import type { VoiceTransport } from "~/server/agents/voice/voice-agent.config";
import type { CallRecord } from "./call-record";
import { elevenLabsConvaiTransport } from "./transports/elevenlabs-convai.transport";

/** The provider key and host a runner reads a conversation back with. Never
 *  reaches the browser — a runner keeps it and returns only the signed URL. */
export interface VoiceTransportCredential {
  apiKey: string;
  baseUrl: string;
}

/** What a minted browser session needs to open the call, minus the id and
 *  limit the service adds. The signed URL is short-lived and safe to hand out;
 *  the key is not, and never appears here. */
export interface VoiceSessionConnect {
  signedUrl: string;
}

export interface VoiceTransportRunner {
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
  mintSession(input: {
    agentId: string;
    credential: VoiceTransportCredential;
  }): Promise<VoiceSessionConnect>;
  /**
   * Read the finished conversation back as a normalised {@link CallRecord}.
   * Returns `null` when the provider has no record yet (the caller falls back
   * to the browser transcript); throws when the fetch itself fails, so the
   * caller can tell "not ready" from "could not be fetched" (AC15). When the
   * conversation has audio, the record's `audioUrl` is set to `audioProxyUrl`
   * — the provider bytes are streamed through the app, never with the key.
   */
  fetchCallRecord(input: {
    conversationId: string;
    credential: VoiceTransportCredential;
    audioProxyUrl: string;
  }): Promise<CallRecord | null>;
  /**
   * End the live call now. Called when the whole-call limit elapses, so the
   * drained transcript is still judged (AC28). The "hang up" verb lives on the
   * runner contract rather than being cast out of the adapter at the call site,
   * so a later transport ends its call its own way.
   */
  endCall(adapter: AgentAdapter): Promise<void>;
  /** Customer-facing failure when the project has no key for this transport. */
  readonly missingKeyMessage: string;
}

export const voiceTransportRegistry: Record<
  VoiceTransport,
  VoiceTransportRunner
> = {
  elevenlabs_convai: elevenLabsConvaiTransport,
};
