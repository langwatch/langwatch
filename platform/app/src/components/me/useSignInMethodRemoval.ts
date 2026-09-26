import { useState } from "react";

import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import type { AccountIdentifier } from "~/server/app-layer/identity/account-identifiers.service";
import { api } from "~/utils/api";

/** The method a confirmation dialog is open for. */
export interface SignInMethodRemovalTarget {
  accountId: string;
  /** What the question calls it — "Remove Google?", not "Remove this?". */
  name: string;
  /** Whether another way in becomes primary before this one detaches. */
  demotesFirst: boolean;
}

/**
 * Giving up one way in — the password, or a linked account — as one behaviour
 * both sections share.
 *
 * The verdict comes from the identity heads rather than from counting rows on
 * the screen. Counting said "two is enough", which is wrong in both
 * directions: two passkeys are two rows and no way back, and a member of an
 * organization that federates was refused a click that is perfectly safe
 * because signing in again re-links it.
 *
 * A refused removal is stood down BEFORE the click and says why, in the
 * registry's words for the code the route would refuse with. The route is
 * still the authority: it refuses whatever the screen happened to draw.
 */
export function useSignInMethodRemoval({
  successTitle,
  failureTitle,
}: {
  successTitle: string;
  failureTitle: string;
}) {
  const identifiers = api.identity.myIdentifiers.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const apiContext = api.useUtils();
  const [target, setTarget] = useState<SignInMethodRemovalTarget | null>(null);

  /** What the detach guard would say about giving this one up, or nothing
   *  when no identifier mirrors the protocol row yet. */
  const verdictFor = (accountId: string): AccountIdentifier | null =>
    identifiers.data?.find(
      (identifier) => identifier.accountId === accountId,
    ) ?? null;

  /** The confirmed ways in that would still be there afterwards. */
  const staysBehind = (accountId: string): string[] =>
    (identifiers.data ?? [])
      .filter(
        (identifier) =>
          identifier.accountId !== accountId && identifier.confirmed,
      )
      .map((identifier) =>
        identifier.provider === "passkey"
          ? "a passkey"
          : (identifier.value ?? identifier.provider),
      );

  const remove = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await Promise.all([
        apiContext.user.getLinkedAccounts.invalidate(),
        apiContext.user.hasPassword.invalidate(),
        apiContext.identity.myIdentifiers.invalidate(),
      ]);
      toaster.create({ title: successTitle, type: "success" });
    } catch (error) {
      // The detach guard refuses a removal that would leave nobody able to
      // get back in, and its refusal is a registered code — the words come
      // from the code-keyed registry, never from the wire message.
      showErrorToast({ error, fallbackTitle: failureTitle });
    } finally {
      setTarget(null);
    }
  };

  return {
    target,
    ask: (asked: SignInMethodRemovalTarget) => setTarget(asked),
    cancel: () => setTarget(null),
    confirm: (accountId: string) => void remove(accountId),
    isRemoving: unlinkAccount.isPending,
    verdictFor,
    staysBehind,
    /**
     * The failure that stopped the verdicts being read, for the section to
     * render as an alert. The ERROR itself rather than a flag: the words a
     * person reads come from the code-keyed registry, and a boolean cannot
     * carry a code — a section that only knew "something failed" would have to
     * write its own sentence about a cause it does not know.
     */
    verdictsError: identifiers.error,
  };
}
