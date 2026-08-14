/** Per-request deadline for the trigger commands’ control-plane calls —
 *  without one, a peer that keeps the socket open hangs the CLI forever
 *  (`require-fetch-timeout-ts`). */
export const TRIGGER_REQUEST_TIMEOUT_MS = 30_000;
