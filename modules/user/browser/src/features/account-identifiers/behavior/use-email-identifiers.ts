/**
 * The account's sign-in addresses over `identity.*`: list, add, resend, remove. The account's
 * own address is read and resent through `auth.*`, which answers whether email can be sent.
 * Spec: specs/identity/authentication-settings.feature
 */

import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import type { AccountIdentifier } from "@langwatch/identity-contract";
import { useState } from "react";

import { api } from "../../../behavior/personal-workspace-api.ts";
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
    await Promise.all([
      utils.identity.myIdentifiers.invalidate(),
      utils.auth.myAddressConfirmation.invalidate(),
    ]);
  };
}

/**
 * Sends a link again. The own address goes through `auth.*`, whose server names the identifier
 * the verifier is filed under; an added address through `identity.*`, under its own id.
 */
function useAddressResend({
  ownAddress,
  onSent,
}: {
  ownAddress: string | undefined;
  onSent: (value: string | undefined) => void;
}) {
  const host = usePersonalWorkspaceHost();
  const own = api.auth.sendMyAddressConfirmation.useMutation();
  const added = api.identity.resendIdentifierConfirmation.useMutation();
  const [resendingId, setResendingId] = useState<string | undefined>(void 0);

  const sendOwn = async (): Promise<void> => {
    const { codeVerifier, codeChallenge } = await mintAddressCeremony();
    const { identifierId } = await own.mutateAsync({ codeChallenge });
    rememberAddressVerifier({ identifierId, codeVerifier });
  };

  const sendAdded = async (identifierId: string): Promise<void> => {
    const { codeVerifier, codeChallenge } = await mintAddressCeremony();
    await added.mutateAsync({ identifierId, codeChallenge });
    rememberAddressVerifier({ identifierId, codeVerifier });
  };

  /** Resolves the server's wait when it refused for rate limiting, so the row holds for it. */
  const resend = async (row: {
    identifierId: string | undefined;
    value: string | null;
  }): Promise<number | undefined> => {
    setResendingId(row.identifierId);
    try {
      const { identifierId } = row;
      await (identifierId === void 0 || row.value === ownAddress
        ? sendOwn()
        : sendAdded(identifierId));
      onSent(row.value ?? void 0);
      return void 0;
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't send that link" });
      return retryAfterOf(error);
    } finally {
      setResendingId(void 0);
    }
  };

  return { resend, resendingId, isOwnAddressSending: own.isPending };
}

export function useEmailIdentifiers() {
  const host = usePersonalWorkspaceHost();
  const identifiers = api.identity.myIdentifiers.useQuery({});
  const confirmation = api.auth.myAddressConfirmation.useQuery();
  const lastUsed = api.identity.myMethodsLastUsed.useQuery({});
  const addMutation = api.identity.addEmailIdentifier.useMutation();
  const removeMutation = api.identity.removeIdentifier.useMutation();
  const refresh = useRefreshEmailIdentifiers();
  const ownAddress = confirmation.data?.email ?? host.currentUser()?.email ?? void 0;
  const canSend = confirmation.data?.canSendConfirmation !== false;

  const [sentTo, setSentTo] = useState<string | undefined>(void 0);
  const resender = useAddressResend({ ownAddress, onSent: setSentTo });

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
    emailRows: rows
      .filter((row) => row.provider === "email")
      .map((row) => (canSend ? row : { ...row, resendable: false })),
    ownAddress,
    ownAddressConfirmed: confirmation.data?.confirmed,
    ownAddressResendable: confirmation.data?.confirmed === false && canSend,
    isOwnAddressSending: resender.isOwnAddressSending,
    isPending: identifiers.isPending || confirmation.isPending,
    error: identifiers.error,
    lastUsedByIdentifier: lastUsed.data?.byIdentifier ?? {},
    sentTo,
    resendingId: resender.resendingId,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
    add,
    resend: resender.resend,
    remove,
    refresh,
  };
}

export type EmailIdentifiers = ReturnType<typeof useEmailIdentifiers>;
