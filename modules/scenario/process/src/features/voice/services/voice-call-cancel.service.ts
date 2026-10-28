import type { TwilioCallControlChannel } from "../../../channels/twilio-call-control.channels.ts";
import type { PendingVoiceCallRepository } from "../../../repositories/pending-voice-call.repository.ts";

/** Long enough to outlast the call, so a late claim, put or call SID still reads as cancelled. */
const TOMBSTONE_TTL_SECONDS = 3600;

/**
 * Cancels a run's phone call: tombstones the pending record, then ends the call at Twilio when
 * its SID is known. A SID not known yet is refused later by the repository, so the dialler
 * hangs up itself.
 */
export class VoiceCallCancelService {
  static create(input: {
    pending: PendingVoiceCallRepository;
    callControl: TwilioCallControlChannel;
  }): VoiceCallCancelService {
    return new VoiceCallCancelService(input.pending, input.callControl);
  }

  private constructor(
    private readonly pending: PendingVoiceCallRepository,
    private readonly callControl: TwilioCallControlChannel,
  ) {}

  async cancel(input: { projectId: string; scenarioRunId: string }): Promise<void> {
    const outcome = await this.pending.cancel({
      scenarioRunId: input.scenarioRunId,
      tombstoneTtlSeconds: TOMBSTONE_TTL_SECONDS,
    });
    const live = outcome.state === "pending" || outcome.state === "claimed";
    if (live && outcome.callSid !== undefined) {
      await this.callControl.endCall({ projectId: input.projectId, callSid: outcome.callSid });
    }
  }
}
