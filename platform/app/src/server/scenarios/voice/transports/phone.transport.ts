/**
 * The phone (Twilio) transport: stub.
 *
 * A phone target is dialled from the voice worker, which does not exist yet
 * (langwatch/langwatch#8014). This module keeps the phone member selectable and
 * inert: every method of the runner throws one typed, customer-facing error, so
 * nothing can be run over phone until the worker ships. It mirrors the file
 * layout of {@link elevenLabsConvaiTransport}: this is the ONE module that
 * will later name Twilio, but wires no vendor SDK yet.
 *
 * `mintSession` throws it too: there is no browser call over phone, so a
 * "Talk to it" mint has nothing to mint.
 */

import { HandledError } from "@langwatch/handled-error";
import type { AgentAdapter } from "@langwatch/scenario";
import type { VoiceTransportRunner } from "../voice-transport.registry";

/** Shown on any attempt to run a phone target before the voice worker exists. */
export const PHONE_TRANSPORT_UNAVAILABLE_MESSAGE =
  "Phone targets are called from the voice worker, which is not available yet. Track langwatch/langwatch#8014.";

/**
 * A phone target was exercised before the voice worker that dials it exists.
 * Every method of the stub runner throws this one code, so the failure reads
 * the same wherever it surfaces. Extends the same {@link HandledError} base the
 * voice-session errors use, with the base's default customer fault.
 */
export class VoicePhoneTransportUnavailableError extends HandledError {
  declare readonly code: "voice_phone_transport_unavailable";
  constructor() {
    super(
      "voice_phone_transport_unavailable",
      PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,
      { httpStatus: 400 },
    );
    this.name = "VoicePhoneTransportUnavailableError";
  }
}

export const phoneTransport: VoiceTransportRunner = {
  missingKeyMessage: PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,

  // Runs before the credential lookup, so the API reports the phone-unavailable
  // error rather than a missing-key error the credential absence would raise.
  assertAvailable(): never {
    throw new VoicePhoneTransportUnavailableError();
  },

  // No browser call over phone: there is nothing to mint.
  mintSession(): Promise<never> {
    throw new VoicePhoneTransportUnavailableError();
  },

  fetchCallRecord(): Promise<never> {
    throw new VoicePhoneTransportUnavailableError();
  },

  endCall(): Promise<never> {
    throw new VoicePhoneTransportUnavailableError();
  },

  createAgentAdapter(): AgentAdapter {
    throw new VoicePhoneTransportUnavailableError();
  },
};
