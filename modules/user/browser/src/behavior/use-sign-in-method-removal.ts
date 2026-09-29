import type { AccountIdentifier } from "@langwatch/identity-contract";
import { useState } from "react";

import { usePersonalWorkspaceHost } from "../model/personal-workspace-host.ts";
import { api } from "./personal-workspace-api.ts";

/** The method a confirmation dialog is open for. */
export type SignInMethodRemovalTarget = {
  accountId: string;
  /** What the question calls it: "Remove your password?", not "Remove this?". */
  name: string;
  /** Whether another way in becomes primary before this one detaches. */
  demotesFirst: boolean;
};

/**
 * Giving up the password as one behaviour. The verdict is the identity module's
 * detach guard, read before the click; the route stays the authority.
 */
export function useSignInMethodRemoval({
  successTitle,
  failureTitle,
}: {
  successTitle: string;
  failureTitle: string;
}) {
  const host = usePersonalWorkspaceHost();
  const identifiers = api.identity.myIdentifiers.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const utils = api.useUtils();
  const [target, setTarget] = useState<SignInMethodRemovalTarget | null>(null);

  const verdictFor = (accountId: string): AccountIdentifier | null =>
    identifiers.data?.find((identifier) => identifier.accountId === accountId) ?? null;

  const staysBehind = (accountId: string): string[] =>
    (identifiers.data ?? [])
      .filter((identifier) => identifier.accountId !== accountId && identifier.confirmed)
      .map((identifier) =>
        identifier.provider === "passkey" ? "a passkey" : (identifier.value ?? identifier.provider),
      );

  const remove = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await Promise.all([
        utils.user.getLinkedAccounts.invalidate(),
        utils.user.hasPassword.invalidate(),
        utils.identity.myIdentifiers.invalidate(),
      ]);
      host.succeeded({ title: successTitle });
    } catch (error) {
      host.failed({ error, fallbackTitle: failureTitle });
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
  };
}
