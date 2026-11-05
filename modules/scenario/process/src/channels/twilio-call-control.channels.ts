/** Twilio's call control: the worker places a run's call and hangs it up if it ends early. */
export interface TwilioCallControlChannel {
  /** Dials `to` from the project's Twilio account; media streams back to `nonce`'s door. */
  placeCall(input: { projectId: string; to: string; nonce: string }): Promise<{ callSid: string }>;
  /** Ends the live call `callSid` of the project's Twilio account. */
  endCall(input: { projectId: string; callSid: string }): Promise<void>;
}
