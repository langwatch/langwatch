import type { TwilioCallControlChannel } from "../twilio-call-control.channels.ts";

/** Records the calls it was told to end; nothing reaches Twilio. */
export class MemoryTwilioCallControlChannel implements TwilioCallControlChannel {
  readonly endedCalls: { projectId: string; callSid: string }[] = [];

  static create(): MemoryTwilioCallControlChannel {
    return new MemoryTwilioCallControlChannel();
  }

  private constructor() {}

  async endCall(input: { projectId: string; callSid: string }): Promise<void> {
    this.endedCalls.push({ projectId: input.projectId, callSid: input.callSid });
  }
}
