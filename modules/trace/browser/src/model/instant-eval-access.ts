/**
 * Whether the Explorer may judge with Instant Evals, and what the refusal
 * popover offers when it may not.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */

export type { InstantEvalAccessAnswer, InstantEvalOptInOffer } from "@langwatch/trace-contract";

/**
 * The release flag or the organization's own switch, either one is enough.
 * True while either read is in flight: a server refusal then says why, so a
 * slow read never hides a feature the project actually has.
 */
export function isInstantEvalAvailable(reads: {
  flagReleased: boolean;
  flagLoading: boolean;
  accessReleased: boolean;
  accessLoading: boolean;
}): boolean {
  return reads.flagReleased || reads.flagLoading || reads.accessReleased || reads.accessLoading;
}
