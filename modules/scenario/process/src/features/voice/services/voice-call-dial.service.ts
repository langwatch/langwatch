import type { TwilioCallControlChannel } from "../../../channels/twilio-call-control.channels.ts";
import {
  PENDING_VOICE_CALL_TTL_SECONDS,
  type PendingVoiceCallRepository,
} from "../../../repositories/pending-voice-call.repository.ts";

export type VoiceCallDialResult =
  | { dialed: true; callSid: string }
  | { dialed: false; reason: "already-dialed" | "cancelled" | "expired" };

/**
 * The worker dials a run's call (https://github.com/langwatch/tasks/issues/1002, slice 3). The
 * pending call is stored before the dial, so any pod can claim it as soon as Twilio connects.
 *
 * At most one dial per `{scenarioRunId, nonce}`: the caller must pass the same nonce on every
 * retry of one run's dial, for example a nonce made once when the dial job is enqueued and kept
 * in the job data. A retry then finds its own pending or claimed call and answers
 * `already-dialed`. This holds for retries in sequence; two dials racing for one key can both
 * dial, so the caller runs one dial job per key (queue job id = the key).
 *
 * A dial that throws leaves its call pending, so a retry does not dial again; the run fails at
 * the claim deadline (`expirePendingVoiceCallIfUnclaimed`). Not wired into the app yet.
 */
export class VoiceCallDialService {
  static create(input: {
    pending: PendingVoiceCallRepository;
    callControl: TwilioCallControlChannel;
  }): VoiceCallDialService {
    return new VoiceCallDialService(input.pending, input.callControl);
  }

  private constructor(
    private readonly pending: PendingVoiceCallRepository,
    private readonly callControl: TwilioCallControlChannel,
  ) {}

  async dial(input: {
    projectId: string;
    scenarioRunId: string;
    nonce: string;
    to: string;
  }): Promise<VoiceCallDialResult> {
    const { projectId, scenarioRunId, nonce, to } = input;

    // `put` overwrites a still-pending call, so it only refuses a retry once the call is claimed.
    const existing = await this.pending.peek({ scenarioRunId, nonce });
    if (existing.found) return { dialed: false, reason: "already-dialed" };

    const stored = await this.pending.put({
      call: { nonce, projectId, scenarioRunId },
      ttlSeconds: PENDING_VOICE_CALL_TTL_SECONDS,
    });
    if (!stored.stored) {
      return { dialed: false, reason: stored.reason === "claimed" ? "already-dialed" : "cancelled" };
    }

    const { callSid } = await this.callControl.placeCall({ projectId, to, nonce });
    const attached = await this.pending.attachCallSid({ scenarioRunId, callSid });
    if (!attached.attached) {
      // The cancel or the lapse came while dialling and could not see this SID: hang up here.
      await this.callControl.endCall({ projectId, callSid });
      return { dialed: false, reason: attached.reason === "cancelled" ? "cancelled" : "expired" };
    }
    return { dialed: true, callSid };
  }
}
