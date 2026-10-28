import type { TwilioCallControlChannel } from "../../../channels/twilio-call-control.channels.ts";
import {
  type PendingVoiceCallRepository,
  VOICE_CALL_RECORD_TTL_SECONDS,
} from "../../../repositories/pending-voice-call.repository.ts";

/**
 * Cancels a run's call: tombstones the record, then ends the call at Twilio when its SID is known.
 * The run-cancel path publishes the `scenario:cancel` broadcast that kills a claimed child;
 * slice 3 wires this service beside it.
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
      tombstoneTtlSeconds: VOICE_CALL_RECORD_TTL_SECONDS,
    });
    const live = outcome.state === "pending" || outcome.state === "claimed";
    if (live && outcome.callSid !== undefined) {
      await this.callControl.endCall({ projectId: input.projectId, callSid: outcome.callSid });
    }
  }
}
