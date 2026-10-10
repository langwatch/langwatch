import { defineSlice } from "@langwatch/browser-host/global-store";

/**
 * A WebAuthn ceremony somebody deliberately started, published so the card can become a state
 * about waiting. The address field's conditional offer never publishes here (ADR-120).
 */

/** Long enough to fetch a phone; past it the card admits it heard nothing, without cancelling. */
export const PASSKEY_CEREMONY_PATIENCE_MS = 60_000;

/** What the ceremony is for, which is all the panel needs to name it. */
export type PasskeyCeremonyPurpose = "sign-in" | "sign-up";

export type PasskeyCeremonyState = Readonly<{
  purpose: PasskeyCeremonyPurpose;
  /** `waiting` until the patience runs out, then `unanswered`. */
  status: "waiting" | "unanswered";
  cancel: () => void;
  retry: () => void;
}>;

const usePasskeyCeremonySlice = defineSlice<{ ceremony: PasskeyCeremonyState | null }>({
  name: "auth:passkey-ceremony",
  create: () => ({ ceremony: null }),
});

let patience: ReturnType<typeof setTimeout> | null = null;

function stopPatience(): void {
  if (patience !== null) clearTimeout(patience);
  patience = null;
}

function live(): PasskeyCeremonyState | null {
  return usePasskeyCeremonySlice.getState().ceremony;
}

/** The ceremony currently in flight, or null. */
export function usePasskeyCeremony(): PasskeyCeremonyState | null {
  return usePasskeyCeremonySlice((state) => state.ceremony);
}

/** The caller owns the abort (`cancel`), because only it knows what "stop" means for its flow. */
export function startPasskeyCeremony({
  purpose,
  cancel,
  retry,
}: {
  purpose: PasskeyCeremonyPurpose;
  cancel: () => void;
  retry: () => void;
}): void {
  stopPatience();
  usePasskeyCeremonySlice.setState({ ceremony: { purpose, status: "waiting", cancel, retry } });
  patience = setTimeout(() => {
    const current = live();
    if (current?.status !== "waiting") return;
    usePasskeyCeremonySlice.setState({ ceremony: { ...current, status: "unanswered" } });
  }, PASSKEY_CEREMONY_PATIENCE_MS);
}

/** The ceremony resolved, one way or the other. Nothing is drawn any more. */
export function endPasskeyCeremony(): void {
  stopPatience();
  if (live() !== null) usePasskeyCeremonySlice.setState({ ceremony: null });
}

/** Cancel, as the panel means it: stand down, then tell the caller. Never a failure. */
export function cancelPasskeyCeremony(): void {
  const current = live();
  endPasskeyCeremony();
  current?.cancel();
}

/** Try again from the unanswered state. Not a cancel, which hands over to the other ways in. */
export function retryPasskeyCeremony(): void {
  const current = live();
  endPasskeyCeremony();
  current?.retry();
}
