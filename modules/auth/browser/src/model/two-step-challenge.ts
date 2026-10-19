import { useSyncExternalStore } from "react";

/**
 * The second factor between a correct password and a session. A module store:
 * the password form that finds it sits down a rail, the card that draws it is
 * the screen's. Holds nothing about the account, so it confirms nothing.
 */
export type TwoStepFactor = "authenticator" | "backup-code";

export type TwoStepChallenge = Readonly<{
  factor: TwoStepFactor;
  /** Where the browser goes once the code is accepted. */
  callbackUrl?: string;
}>;

let live: TwoStepChallenge | null = null;
const listeners = new Set<() => void>();

function publish(next: TwoStepChallenge | null): void {
  live = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The challenge currently standing, or null. */
export function useTwoStepChallenge(): TwoStepChallenge | null {
  return useSyncExternalStore(
    subscribe,
    () => live,
    () => null,
  );
}

/** Always opens on the authenticator: a backup code is spent, never suggested. */
export function startTwoStepChallenge({ callbackUrl }: { callbackUrl?: string }): void {
  publish({ factor: "authenticator", callbackUrl });
}

/** Swap which box is on screen, keeping the challenge itself standing. */
export function showTwoStepFactor({ factor }: { factor: TwoStepFactor }): void {
  if (!live || live.factor === factor) return;
  publish({ ...live, factor });
}

/** Stand down; the half-signed-in cookie expires on its own. */
export function endTwoStepChallenge(): void {
  if (live !== null) publish(null);
}

/** Test seam: the store outlives a render, so a suite has to reset it. */
export function _resetTwoStepChallengeForTests(): void {
  live = null;
  listeners.clear();
}
