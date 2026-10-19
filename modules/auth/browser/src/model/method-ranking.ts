import type { SignInMethod } from "@langwatch/identity-contract";

/**
 * The server ranks methods strongest-first; the browser promotes only the one
 * this person last used here, and everything else keeps the server's order
 * (ADR-117, revision 2026-08-25). A hint naming an absent method promotes nothing.
 */
export function rankMethodsForBrowser({
  methodSet,
  lastUsedMethodId,
}: {
  methodSet: readonly SignInMethod[];
  lastUsedMethodId?: string | null;
}): readonly SignInMethod[] {
  if (!lastUsedMethodId) return methodSet;
  const lastUsed = methodSet.find((method) => method.id === lastUsedMethodId);
  if (!lastUsed) return methodSet;
  return [lastUsed, ...methodSet.filter((method) => method !== lastUsed)];
}

/**
 * Start a passkey ceremony on arrival only when the decision is about an
 * account (`account_methods`) that holds one, and only once: the address
 * submit was the gesture (ADR-120), a second attempt would be the screen insisting.
 */
export function shouldStartPasskeyOnArrival({
  reasonCode,
  methodSet,
  alreadyTried,
}: {
  reasonCode: string;
  methodSet: readonly SignInMethod[];
  alreadyTried: boolean;
}): boolean {
  if (alreadyTried) return false;
  if (reasonCode !== "account_methods") return false;
  return methodSet.some((method) => method.kind === "passkey");
}

/**
 * A passkey seat only where somebody plausibly holds one: the account named it
 * (`account_methods`), or this browser has used or made one. Elsewhere the
 * address field's autofill is the way to a passkey on a new device.
 */
export function methodsWorthOffering({
  methodSet,
  reasonCode,
  passkeyOnThisDevice,
}: {
  methodSet: readonly SignInMethod[];
  reasonCode: string | null;
  passkeyOnThisDevice: boolean;
}): readonly SignInMethod[] {
  if (passkeyOnThisDevice || reasonCode === "account_methods") return methodSet;
  return methodSet.filter((method) => method.kind !== "passkey");
}
