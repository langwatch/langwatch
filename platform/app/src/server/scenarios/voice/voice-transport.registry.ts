/**
 * Registry of voice transports: one server interface per transport, so a later
 * transport (phone) is a new entry here rather than a change to the adapter or
 * the child. Nothing outside `transports/` names a vendor — a runner is opaque
 * behind this interface.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import type { VoiceTransport } from "~/server/agents/voice/voice-agent.config";
import { elevenLabsConvaiTransport } from "./transports/elevenlabs-convai.transport";

export interface VoiceTransportRunner {
  /** Build the SDK agent adapter the pool child drives for this transport. */
  createAgentAdapter(input: {
    agentId: string;
    credential: { apiKey: string; baseUrl: string };
    maxCallSeconds: number;
  }): AgentAdapter;
  /** Customer-facing failure when the project has no key for this transport. */
  readonly missingKeyMessage: string;
}

export const voiceTransportRegistry: Record<
  VoiceTransport,
  VoiceTransportRunner
> = {
  elevenlabs_convai: elevenLabsConvaiTransport,
};
