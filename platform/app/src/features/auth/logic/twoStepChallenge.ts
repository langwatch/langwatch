import { useSyncExternalStore } from "react";

/**
 * The second factor standing between a correct password and a session,
 * published so the card the password was typed into can become the card that
 * asks for the code.
 *
 * A module-scoped store rather than a prop, for the same reason
 * `passkeyCeremony.ts` is one: the thing that DISCOVERS the challenge is a
 * password form rendered part-way down a rail of methods, and the thing that
 * has to draw the challenge is the card the rail is inside. Both auth screenss
 * render that form — logging in, and the log-in step sign-up turns into for an
 * address that already has an account — so a prop would be the same wiring
 * threaded through two screens and every component between them.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────
 *
 * Anything about the account. Not which factors it holds, not whether it has
 * backup codes left, not how many attempts remain. The screen offers the
 * backup-code box to everybody who reaches it and the server answers a wrong
 * authenticator code and a wrong backup code with one indistinguishable
 * refusal (`server/better-auth/handled-errors.ts`), so nothing a person can
 * see here tells them anything about an account that is not theirs.
 *
 * The person's address is not here either. It is on screen one step behind
 * this card and it does not need to be on this one: a code box is not a field
 * a password manager fills, and repeating an identifier onto a screen that
 * anybody who guessed a password can reach is how a challenge becomes a
 * confirmation that the password was right for *that* address.
 *
 * Spec: specs/identity/signin-signup-screens.feature,
 * specs/identity/mfa-and-session-shape.feature.
 */

/** Which box is on screen. Both are always reachable from the other. */
export type TwoStepFactor = "authenticator" | "backup-code";

export interface TwoStepChallengeState {
  factor: TwoStepFactor;
}

interface LiveChallenge extends TwoStepChallengeState {
  /** Where the browser goes once the code is accepted. */
  callbackUrl?: string;
}

let live: LiveChallenge | null = null;
const listeners = new Set<() => void>();

function publish(next: LiveChallenge | null): void {
  live = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = (): LiveChallenge | null => live;
const serverSnapshot = (): LiveChallenge | null => null;

/** The challenge currently standing, or null. */
export function useTwoStepChallenge(): LiveChallenge | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * A password was accepted and a second factor is being asked for.
 *
 * Always opens on the authenticator, because that is the factor somebody has
 * in their pocket. The backup-code box is one click away and never the one
 * offered first: a backup code is a thing you spend, and spending one because
 * the screen suggested it is a code gone for nothing.
 */
export function startTwoStepChallenge({
  callbackUrl,
}: {
  callbackUrl?: string;
}): void {
  publish({ factor: "authenticator", callbackUrl });
}

/** Swap which box is on screen, keeping the challenge itself standing. */
export function showTwoStepFactor(factor: TwoStepFactor): void {
  if (!live || live.factor === factor) return;
  publish({ ...live, factor });
}

/**
 * Stand down.
 *
 * Nothing is revoked on the way out, and nothing needs to be: the half-signed-in
 * state is a short-lived cookie that authorises exactly one thing — answering
 * this challenge — and it expires on its own. Calling an endpoint to tear it
 * down would be a request whose only effect is to be one more thing that can
 * fail while somebody is trying to leave.
 */
export function endTwoStepChallenge(): void {
  if (live !== null) publish(null);
}

/** Test seam: the store outlives a render, so a suite has to reset it. */
export function _resetTwoStepChallengeForTests(): void {
  live = null;
  listeners.clear();
}
