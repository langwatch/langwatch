/**
 * What a call's failure text starts with when the user's own Stop ended it. The worker
 * (services/langyworker/src/tools/local-workspace.ts) cannot import this package, so a
 * contract test pins its `CANCELLED_PUSHBACK` to this prefix.
 */
export const LANGY_CALL_STOPPED_PREFIX = "cancelled: the turn was stopped";

/** Whether a failed call's text says the user's own Stop ended it, which is no failure. */
export function isLangyCallStoppedText(errorText: unknown): boolean {
  return typeof errorText === "string" && errorText.trim().startsWith(LANGY_CALL_STOPPED_PREFIX);
}
