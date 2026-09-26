import type { VoiceTransport } from "@langwatch/scenario-contract";

import type { VoiceTransportClient } from "../model/voice-call.ts";
import { elevenLabsConvaiClient } from "./elevenlabs-convai.client.ts";

/** A phone target is dialled from the voice worker, not the browser, so it has no client here. */
export const voiceTransportClientRegistry: Partial<Record<VoiceTransport, VoiceTransportClient>> = {
  elevenlabs_convai: elevenLabsConvaiClient,
};

/** The browser client for a transport; undefined for a transport with no browser call. */
export const getVoiceTransportClient = (
  transport: VoiceTransport,
): VoiceTransportClient | undefined => voiceTransportClientRegistry[transport];
