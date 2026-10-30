/*
 * The claim deadline for a dialled call (https://github.com/langwatch/tasks/issues/1002, slice 3).
 *
 * A plain function, deliberately not an eventing command and not on a job queue yet. A new
 * command type needs a new command, schema and version in @langwatch/scenario-contract and a
 * pipeline registration; scheduling the delay needs the queue that only scenario.app.ts builds.
 * Both are outside this unwired slice. When the dial is wired, the caller schedules this
 * `VOICE_CALL_CLAIM_DEADLINE_SECONDS` after the dial and fails the run on `expired`.
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
 * Gives up a call that no pod claimed by the deadline: takes the claim itself, so a pod that
 * connects at the same moment either wins the call or is refused, then cancels the run, which
 * ends the call at Twilio. Answers `expired` only when it took the call.
 *
 * A crash between the claim and the cancel leaves the call ringing until Twilio's own timeout;
 * a retry then answers `already-claimed`.
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
