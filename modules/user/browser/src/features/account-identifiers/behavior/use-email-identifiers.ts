/**
 * The account's sign-in addresses over `identity.*`: list, add, resend, remove.
 * Spec: specs/identity/authentication-settings.feature
 */

import type { AccountIdentifier } from "@langwatch/identity-contract";
import { useState } from "react";

import { api } from "../../../behavior/personal-workspace-api.ts";
import { readHandledError } from "../../../model/handled-error.ts";
import { usePersonalWorkspaceHost } from "../../../model/personal-workspace-host.ts";
import {
  forgetAddressVerifier,
  mintAddressCeremony,
  rememberAddressVerifier,
} from "./address-ceremony.ts";

/** The server's own wait when it refused for rate limiting; undefined otherwise. */
function retryAfterOf(error: unknown): number | undefined {
  const retryAfter = readHandledError(error)?.meta.retryAfterSeconds;
  return typeof retryAfter === "number" ? retryAfter : void 0;
}

export function useRefreshEmailIdentifiers(): () => Promise<void> {
  const utils = api.useUtils();
  return async () => {
    await utils.identity.myIdentifiers.invalidate();
  };
}

export function useEmailIdentifiers() {
  const host = usePersonalWorkspaceHost();
  const identifiers = api.identity.myIdentifiers.useQuery({});
  const lastUsed = api.identity.myMethodsLastUsed.useQuery({});
  const addMutation = api.identity.addEmailIdentifier.useMutation();
  const resendMutation = api.identity.resendIdentifierConfirmation.useMutation();
  const removeMutation = api.identity.removeIdentifier.useMutation();
  const refresh = useRefreshEmailIdentifiers();

  const [sentTo, setSentTo] = useState<string | undefined>(void 0);
  const [resendingId, setResendingId] = useState<string | undefined>(void 0);

  const add = async (email: string): Promise<boolean> => {
    if (!email) return false;
    try {
      const { codeVerifier, codeChallenge } = await mintAddressCeremony();
      const { identifierId } = await addMutation.mutateAsync({ email, codeChallenge });
      rememberAddressVerifier({ identifierId, codeVerifier });
      setSentTo(email);
      await refresh();
      return true;
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't add that address" });
      return false;
    }
  };

  /** Resolves the server's wait when it refused for rate limiting, so the row holds for it. */
  const resend = async (row: AccountIdentifier): Promise<number | undefined> => {
    setResendingId(row.identifierId);
    try {
      const { codeVerifier, codeChallenge } = await mintAddressCeremony();
      await resendMutation.mutateAsync({ identifierId: row.identifierId, codeChallenge });
      rememberAddressVerifier({ identifierId: row.identifierId, codeVerifier });
      setSentTo(row.value ?? void 0);
      return void 0;
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't send that link" });
      return retryAfterOf(error);
    } finally {
      setResendingId(void 0);
    }
  };

  const remove = async (row: AccountIdentifier): Promise<void> => {
    try {
      await removeMutation.mutateAsync({ identifierId: row.identifierId });
      forgetAddressVerifier({ identifierId: row.identifierId });
      host.succeeded({ title: "Address removed" });
      await refresh();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't remove that address" });
    }
  };

  const rows = identifiers.data ?? [];

  return {
    emailRows: rows.filter((row) => row.provider === "email"),
    ownAddress: host.currentUser()?.email ?? void 0,
    isPending: identifiers.isPending,
    error: identifiers.error,
    lastUsedByIdentifier: lastUsed.data?.byIdentifier ?? {},
    sentTo,
    resendingId,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
    add,
    resend,
    remove,
    refresh,
  };
}

export type EmailIdentifiers = ReturnType<typeof useEmailIdentifiers>;
