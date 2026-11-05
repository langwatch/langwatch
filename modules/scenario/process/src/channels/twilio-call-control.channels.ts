/** Twilio's call control: the one call to hang up when a run is cancelled. */
export interface TwilioCallControlChannel {
  /** Ends the live call `callSid` of the project's Twilio account. */
  endCall(input: { projectId: string; callSid: string }): Promise<void>;
}
