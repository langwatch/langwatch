/** How long a dialled call may wait for Twilio's media upgrade: 60 s ring timeout plus margin. */
export const PENDING_VOICE_CALL_TTL_SECONDS = 120;

/** How long a claimed run keeps its call SID, so a late cancel can still end the call. */
export const CLAIMED_VOICE_CALL_TTL_SECONDS = 3600;

/** A call placed and waiting for Twilio to dial its media stream back. */
export type PendingVoiceCall = {
  nonce: string;
  projectId: string;
  scenarioRunId: string;
};

export type PendingVoiceCallKey = { scenarioRunId: string; nonce: string };

/** What a cancel found the run in; `cancelled` is a repeat cancel and keeps the call SID. */
export type VoiceCallCancelOutcome = {
  state: "pending" | "claimed" | "cancelled" | "absent";
  callSid?: string;
};

export type PendingVoiceCallPutResult = { stored: true } | { stored: false; reason: "cancelled" };
export type PendingVoiceCallPeekResult = { found: true; call: PendingVoiceCall } | { found: false };
export type PendingVoiceCallClaimResult =
  | { claimed: true; call: PendingVoiceCall }
  | { claimed: false; reason: "unknown" | "cancelled" };
export type PendingVoiceCallAttachResult =
  | { attached: true }
  | { attached: false; reason: "unknown" | "cancelled" };

/**
 * Every worker's pending Twilio calls, shared so any worker can claim the call Twilio dials.
 * A claim is single-use; a cancel leaves a tombstone so a late claim, put or call SID is refused
 * (dev/docs/ARCHITECTURE.md §8, https://github.com/langwatch/tasks/issues/1002).
 */
export interface PendingVoiceCallRepository {
  /** Stores the call for `ttlSeconds`; refused when the run was already cancelled. */
  put(input: { call: PendingVoiceCall; ttlSeconds: number }): Promise<PendingVoiceCallPutResult>;
  /** Reads the call without consuming it. */
  peek(key: PendingVoiceCallKey): Promise<PendingVoiceCallPeekResult>;
  /** Removes the call and answers it as one step, so exactly one claimer wins. */
  claim(key: PendingVoiceCallKey): Promise<PendingVoiceCallClaimResult>;
  /** Cancels the run for `tombstoneTtlSeconds` and reports the state it was in. */
  cancel(input: {
    scenarioRunId: string;
    tombstoneTtlSeconds: number;
  }): Promise<VoiceCallCancelOutcome>;
  /** Records the Twilio call SID; refused as cancelled so the caller hangs the call up itself. */
  attachCallSid(input: {
    scenarioRunId: string;
    callSid: string;
  }): Promise<PendingVoiceCallAttachResult>;
}
