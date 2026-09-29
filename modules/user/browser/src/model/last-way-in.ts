/**
 * One sentence about being one step from locked out, and the remedy: the detach
 * guard's own reasoning read forwards, said while there is still time to act.
 */

import { providerDisplayName } from "./sign-in-methods.ts";

export type LastWayInWarning = {
  /** Which way in is the only one. */
  id: "only-passkey" | "only-password" | "only-linked";
  message: string;
};

type LinkedAccount = { provider: string; providerAccountId: string };

/**
 * The warning when exactly one way in is held, or null. Deliberately not "losing
 * that device would lock you out": a passkey syncs through its provider.
 */
export function lastWayInWarningFor({
  passkeys,
  hasPassword,
  linked,
}: {
  passkeys: number;
  hasPassword: boolean;
  linked: readonly LinkedAccount[];
}): LastWayInWarning | null {
  const passwords = Number(hasPassword);
  if (passkeys + passwords + linked.length !== 1) return null;
  if (passkeys === 1) {
    return {
      id: "only-passkey",
      message:
        "Your passkey is the only way into this account. It syncs to your other devices through your passkey provider, but losing access to that provider would leave you locked out. Set a password or add a second passkey as a backup.",
    };
  }
  if (hasPassword) {
    return {
      id: "only-password",
      message:
        "Your password is the only way into this account. Add a passkey so a forgotten password does not leave you outside.",
    };
  }
  const only = linked[0];
  if (!only) return null;
  const name = providerDisplayName(only.provider, only.providerAccountId);

  return {
    id: "only-linked",
    message: `Signing in through ${name} is the only way into this account. If that access ends, so does this one, so add a passkey or set a password.`,
  };
}
