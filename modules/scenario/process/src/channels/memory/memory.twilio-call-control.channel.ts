import type { TwilioCallControlChannel } from "../twilio-call-control.channels.ts";

type PlacedCall = { projectId: string; to: string; nonce: string };

/**
 * Records the calls it was told to place and end; nothing reaches Twilio. A placed call's SID is
 * `CA<nonce>`. `onPlaceCall` runs while a call is being placed, so a test can act in that gap.
 */
export class MemoryTwilioCallControlChannel implements TwilioCallControlChannel {
  readonly placedCalls: PlacedCall[] = [];
  readonly endedCalls: { projectId: string; callSid: string }[] = [];

  static create(
    options: { onPlaceCall?: (call: PlacedCall) => Promise<void> } = {},
  ): MemoryTwilioCallControlChannel {
    return new MemoryTwilioCallControlChannel(options.onPlaceCall);
  }

  private constructor(private readonly onPlaceCall?: (call: PlacedCall) => Promise<void>) {}

  async placeCall(input: PlacedCall): Promise<{ callSid: string }> {
    const call = { projectId: input.projectId, to: input.to, nonce: input.nonce };
    this.placedCalls.push(call);
    await this.onPlaceCall?.(call);
    return { callSid: `CA${input.nonce}` };
  }

  async endCall(input: { projectId: string; callSid: string }): Promise<void> {
    this.endedCalls.push({ projectId: input.projectId, callSid: input.callSid });
  }
}
