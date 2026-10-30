/*
 * The claim deadline for a dialled call (tasks#1002 slice 3). A plain function, not an eventing
 * command or queue entry: both need pieces outside this unwired slice. When wired, the caller
 * schedules this after the dial and fails the run on `expired`.
 */
import type { PendingVoiceCallRepository } from "../../../repositories/pending-voice-call.repository.ts";
import type { VoiceCallCancelService } from "./voice-call-cancel.service.ts";

/**
 * When an unclaimed call is given up: the 60 s ring timeout plus margin. It must stay below
 * `PENDING_VOICE_CALL_TTL_SECONDS`: after that the pending call lapses, and a lapsed call looks
 * the same as a claimed one.
 */
export const VOICE_CALL_CLAIM_DEADLINE_SECONDS = 90;

export type VoiceCallExpiryOutcome = "expired" | "already-claimed" | "already-cancelled";

/**
 * Gives up a call nobody claimed by the deadline: claims it itself (a racing pod wins or is
 * refused), cancels the run to end the call at Twilio, and answers `expired` only then.
 * A crash between claim and cancel leaves it ringing; a retry then answers `already-claimed`.
 */
export async function expirePendingVoiceCallIfUnclaimed(input: {
  projectId: string;
  scenarioRunId: string;
  nonce: string;
  pending: PendingVoiceCallRepository;
  cancel: VoiceCallCancelService;
}): Promise<VoiceCallExpiryOutcome> {
  const { projectId, scenarioRunId, nonce } = input;
  const taken = await input.pending.claim({ scenarioRunId, nonce });
  if (!taken.claimed) {
    return taken.reason === "cancelled" ? "already-cancelled" : "already-claimed";
  }
  await input.cancel.cancel({ projectId, scenarioRunId });
  return "expired";
}
