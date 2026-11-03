import { createLogger } from "@langwatch/observability";

import type {
  VoiceMediaRelay,
  VoiceMediaRelayBridgeChannel,
  VoiceMediaRelayChannel,
  VoiceMediaRelayCredential,
  VoiceMediaRelayRefusal,
} from "../../../channels/voice-media-relay.channels.ts";
import type { PendingVoiceCallKey } from "../../../repositories/pending-voice-call.repository.ts";
import type { VoiceCallClaimService } from "./voice-call-claim.service.ts";
import type { VoiceCallDialResult, VoiceCallDialService } from "./voice-call-dial.service.ts";

const logger = createLogger("langwatch:voice:call-relay");

/** A relay this worker opened but will not use: the call was not placed. */
const NOT_DIALED = { code: 1000, reason: "voice_call_not_dialed" };
const BRIDGE_FAILED = { code: 1011, reason: "voice_bridge_failed" };

export type VoiceCallRelayResult =
  | VoiceCallDialResult
  | { dialed: false; reason: "no-relay-credential" }
  | { dialed: false; reason: "relay-refused"; refusal: VoiceMediaRelayRefusal };

type VoiceCallRelayDeps = {
  relays: VoiceMediaRelayChannel;
  bridges: VoiceMediaRelayBridgeChannel;
  /** The install's license credential for the gateway; null while Connect is off. */
  credentialFor: (input: { projectId: string }) => Promise<VoiceMediaRelayCredential | null>;
  dialer: Pick<VoiceCallDialService, "dial">;
  claims: Pick<VoiceCallClaimService, "acceptRelayed">;
};

/**
 * Dials a run's call for an install Twilio cannot reach (tasks#1002 slice 4c): opens a gateway
 * relay with the install's license token, dials Twilio with its stream URL, and bridges the joined
 * relay into the claim a direct call takes. An unjoined call fails at the claim deadline.
 */
export class VoiceCallRelayService {
  static create(input: VoiceCallRelayDeps): VoiceCallRelayService {
    return new VoiceCallRelayService(input);
  }

  private constructor(private readonly input: VoiceCallRelayDeps) {}

  async dial(input: {
    projectId: string;
    scenarioRunId: string;
    nonce: string;
    to: string;
  }): Promise<VoiceCallRelayResult> {
    const credential = await this.input.credentialFor({ projectId: input.projectId });
    if (!credential) return { dialed: false, reason: "no-relay-credential" };

    const opened = await this.input.relays.open({ credential });
    if (!opened.opened) {
      logger.warn({ ...opened.refusal }, "the gateway refused to open a voice media relay");
      return { dialed: false, reason: "relay-refused", refusal: opened.refusal };
    }
    const { relay } = opened;

    let result: VoiceCallDialResult;
    try {
      result = await this.input.dialer.dial({ ...input, streamUrl: relay.streamUrl });
    } catch (error) {
      relay.close(NOT_DIALED);
      throw error;
    }
    if (!result.dialed) {
      relay.close(NOT_DIALED);
      return result;
    }
    void this.bridgeOnJoin({
      relay,
      call: { scenarioRunId: input.scenarioRunId, nonce: input.nonce },
    });
    return result;
  }

  private async bridgeOnJoin({
    relay,
    call,
  }: {
    relay: VoiceMediaRelay;
    call: PendingVoiceCallKey;
  }): Promise<void> {
    const outcome = await relay.joined;
    if (!outcome.joined) {
      logger.info(
        { relay: relay.logId, code: outcome.end.code },
        "voice media relay ended before Twilio joined",
      );
      return;
    }
    try {
      await this.input.bridges.bridge({
        relay,
        path: `/twilio/${call.scenarioRunId}/${call.nonce}`,
        twilioSignature: outcome.twilioSignature,
        onUpgrade: (upgrade) =>
          this.input.claims.acceptRelayed({
            upgrade: { ...upgrade, nonce: call.nonce },
            signedUrl: relay.streamUrl,
          }),
      });
    } catch (error) {
      logger.error({ relay: relay.logId, error }, "relayed voice call could not be bridged");
      relay.close(BRIDGE_FAILED);
    }
  }
}
