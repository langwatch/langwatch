import { useSyncExternalStore } from "react";

/**
 * A WebAuthn ceremony that somebody deliberately started, published so the
 * card above it can become a state about waiting.
 *
 * A module-scoped store rather than context or props, for the same reason
 * `groundStage.ts` is one: the thing that STARTS a ceremony is a button
 * part-way down a rail of methods, and the thing that has to draw the waiting
 * state is the card the rail is inside. Threading a callback up through the
 * picker, the alternatives row and every screen that renders either would put
 * a prop on five components so that one of them could change.
 *
 * It is one-way, like the ground's: the ceremony SAYS it is waiting and stops
 * caring. Nothing reads back, and a surface that never draws the panel behaves
 * exactly as it did before this existed — which is what keeps the settings
 * page and the auth screens able to disagree about how they render it.
 *
 * ── What must never publish here ────────────────────────────────────────
 *
 * The conditional-mediation offer (`usePasskeyAutofill`). Nobody started it,
 * so nobody is owed a progress report — and a panel opening over a page
 * somebody came to READ is precisely the ambush the gesture rule in that hook
 * already exists to prevent. ADR-120 says it in one line: it is an offer, not
 * an attempt, and "there is no loading state anywhere near it".
 *
 * Spec: specs/identity/signin-signup-screens.feature.
 */

/**
 * How long a device is given before the screen admits it has heard nothing.
 *
 * Long enough to walk to a phone and unlock it, short enough that somebody
 * staring at a prompt that never opened is not left there. Past it the panel
 * says so and offers both ways on; the ceremony itself is NOT cancelled,
 * because the browser may still be holding a prompt open and killing it from
 * under somebody mid-fingerprint is worse than waiting.
 */
export const PASSKEY_CEREMONY_PATIENCE_MS = 60_000;

/** What the ceremony is for, which is all the panel needs to name it. */
export type PasskeyCeremonyPurpose = "sign-in" | "sign-up" | "register";

export interface PasskeyCeremonyState {
  purpose: PasskeyCeremonyPurpose;
  /** `waiting` until the patience runs out, then `unanswered`. */
  status: "waiting" | "unanswered";
}

interface LiveCeremony extends PasskeyCeremonyState {
  cancel: () => void;
  retry: () => void;
}

/**
 * Whether there is anything else to pick from where this ceremony started.
 *
 * A fact about the PURPOSE rather than something the starter passes: the two
 * auth-screen ceremonies run on a card whose other methods are one step behind
 * the panel, and registering from settings is somebody adding a passkey
 * specifically — there is no other method to offer them, and a link labelled
 * as though there were would be furniture.
 */
export function ceremonyOffersOtherMethods(
  ceremony: PasskeyCeremonyState,
): boolean {
  return ceremony.purpose !== "register";
}

let live: LiveCeremony | null = null;
let patience: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish(next: LiveCeremony | null): void {
  live = next;
  for (const listener of listeners) listener();
}

function stopPatience(): void {
  if (patience !== null) clearTimeout(patience);
  patience = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = (): PasskeyCeremonyState | null => live;
const serverSnapshot = (): PasskeyCeremonyState | null => null;

/** The ceremony currently in flight, or null. */
export function usePasskeyCeremony(): PasskeyCeremonyState | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Whether the rest of the card should stand back right now.
 *
 * Read from the STORE rather than tracked per component, and that is the whole
 * point: the store is cleared in the ceremony's `finally` and by its cancel, so
 * every way a ceremony can end — a sheet somebody closed, a WebAuthn error, a
 * server refusal, a success on its way to a redirect — restores the rail
 * without any of those paths having to remember to. A per-branch restore is
 * how a rail ends up dimmed for good after the one exit nobody thought of.
 *
 * `unanswered` deliberately does NOT hold the rail back. Past the patience
 * window we have stopped waiting on the device, and on a surface with no
 * waiting panel over it — the invitation landing draws its rail throughout —
 * leaving it dimmed would be a card nobody could use and nobody could leave.
 * The ceremony itself is not cancelled; the screen simply stops deferring to
 * it.
 */
export function useOtherMethodsStandBack(): boolean {
  return (
    useSyncExternalStore(subscribe, snapshot, serverSnapshot)?.status ===
    "waiting"
  );
}

/**
 * A ceremony has started because somebody asked for it.
 *
 * `cancel` is what the panel's Cancel does — the caller owns the abort,
 * because only it knows what "stop" means for its own flow. `retry` runs the
 * same ceremony again.
 */
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
  publish({ purpose, status: "waiting", cancel, retry });
  patience = setTimeout(() => {
    if (live?.status !== "waiting") return;
    publish({ ...live, status: "unanswered" });
  }, PASSKEY_CEREMONY_PATIENCE_MS);
}

/** The ceremony resolved, one way or the other. Nothing is drawn any more. */
export function endPasskeyCeremony(): void {
  stopPatience();
  if (live !== null) publish(null);
}

/** Cancel, as the panel's button means it: tell the caller, then stand down. */
export function cancelPasskeyCeremony(): void {
  const current = live;
  endPasskeyCeremony();
  current?.cancel();
}

/**
 * Try the same ceremony again from the unanswered state.
 *
 * `cancel` is deliberately NOT called here, even though it is what marks an
 * attempt abandoned: cancelling is declining, and it hands the person to the
 * other ways in — which is the opposite of what "Try again" means. Standing
 * the previous attempt down is the caller's to do when it starts the next
 * one; see `dial` in `PasskeySignInButton`.
 */
export function retryPasskeyCeremony(): void {
  const current = live;
  endPasskeyCeremony();
  current?.retry();
}

/**
 * Leave the ceremony for the other ways in.
 *
 * The same destination Cancel reaches, and both are offered on purpose: on a
 * card whose method rail is one step behind the panel they land in the same
 * place, and that IS the reassurance — neither button is a dead end, and
 * somebody who reads "cancel" as "give up" and somebody who reads it as "go
 * back" both get what they meant.
 */
export function leavePasskeyCeremonyForOtherMethods(): void {
  cancelPasskeyCeremony();
}
