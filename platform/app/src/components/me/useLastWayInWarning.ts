import { signInMethodLabel } from "~/features/auth/logic/methodLabels";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { authClient } from "~/utils/auth-client";
import { isCredentialAccount, linkedAccountMethodId } from "./signInAccounts";

/** The one sentence about being one step from locked out, and the remedy. */
export interface LastWayInWarning {
  /** Which way in is the only one — the test's handle on the case. */
  id: "only-passkey" | "only-password" | "only-linked";
  message: string;
}

/**
 * Whether this account is one lost device, one forgotten password or one
 * closed provider account away from being locked out — and what to do first.
 *
 * It is the detach guard's own reasoning, read FORWARDS. The guard refuses to
 * remove the last way in, which is help arriving at the worst possible moment:
 * the person is already down to one and only finds out when they try to tidy
 * up. Said in advance it is the same fact, early enough to act on.
 *
 * It answers only this. An earlier version of this hook also counted passkeys,
 * two-step verification and linked accounts into a summary beside the page,
 * and that was rejected on sight — correctly. A person who has just read the
 * bands does not need them counted back; the only thing worth adding is what
 * their COMBINATION means, and this is the whole of that.
 *
 * Silence unless it is certain. The counts come from two reads, and a count
 * that is short by one turns this into a false alarm about somebody's account
 * security — so nothing is said until the reads have landed.
 */
/** Which single way in it is, once the count says there is only one. */
function nameTheOnlyWayIn({
  passkeys,
  hasPassword,
  linked,
}: {
  passkeys: number;
  hasPassword: boolean;
  linked: readonly { provider: string; providerAccountId: string }[];
}): LastWayInWarning | null {
  if (passkeys === 1) {
    return {
      id: "only-passkey",
      // Deliberately NOT "losing that device would lock you out". A passkey
      // syncs across the devices signed in to its provider, and saying
      // otherwise repeats the misconception the guidance warns about — people
      // already believe a passkey lives on one phone. The real residual risk
      // is the provider account, or a key that never syncs at all.
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
  const name = signInMethodLabel({
    id: linkedAccountMethodId(only),
    kind: "federated",
    connectionId: null,
  });
  return {
    id: "only-linked",
    message: `Signing in through ${name} is the only way into this account. If that access ends, so does this one — add a passkey or set a password.`,
  };
}

export function useLastWayInWarning(): LastWayInWarning | null {
  const publicEnv = usePublicEnv();
  const passkeys = authClient.useListPasskeys();
  const accounts = api.user.getLinkedAccounts.useQuery({});
  const passwordStatus = api.user.hasPassword.useQuery({});

  const provider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const offersPasskeys = publicEnv.data?.PASSKEYS_ENABLED === true;

  // Nothing is claimed until both halves of the count are in hand.
  if (!accounts.data) return null;
  if (offersPasskeys && passkeys.isPending) return null;
  if (provider === "email" && !passwordStatus.data) return null;

  const linked = accounts.data.filter(
    (account) => !isCredentialAccount(account),
  );
  const heldPasskeys = offersPasskeys ? (passkeys.data ?? []).length : 0;
  const hasPassword =
    provider === "email"
      ? passwordStatus.data?.hasPassword === true
      : accounts.data.some(isCredentialAccount);

  const waysIn = heldPasskeys + (hasPassword ? 1 : 0) + linked.length;
  if (waysIn !== 1) return null;

  return nameTheOnlyWayIn({ passkeys: heldPasskeys, hasPassword, linked });
}
