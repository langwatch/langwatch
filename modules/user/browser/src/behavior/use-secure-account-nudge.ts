import { useState } from "react";

import { usePersonalWorkspaceHost } from "../model/personal-workspace-host.ts";
import { api } from "./personal-workspace-api.ts";

/** Where "Set up two-step verification" leads: the account's own Security page. */
const SECURITY_SETTINGS = "/settings/security";

/**
 * What each answer to the account-security offer does (ADR-120, D06). Every
 * path closes the dialog locally at once; the account write goes out before
 * anything is awaited, and survives the page, so "Not now" is never lost.
 */
export function useSecureAccountNudge() {
  const host = usePersonalWorkspaceHost();
  const utils = api.useUtils();
  const nudge = api.user.secureAccountNudge.useQuery({});
  // Identity answers whether the organization's single sign-on governs sign-in; asked only
  // when a passkey is on offer, and the offer waits for it so it never flickers.
  const governance = api.identity.mySignInGovernance.useQuery(
    {},
    { enabled: nudge.data?.passkey === true },
  );
  const ssoGoverned = governance.data?.governedBySso === true;
  const offer =
    nudge.data?.passkey && governance.isPending
      ? undefined
      : withoutGovernedPasskey(nudge.data, ssoGoverned);
  // Settled on the mutation, not the call: writing the answer into the cached
  // offer unmounts this dialog, and a callback handed to `mutate` goes with it.
  const dismiss = api.user.dismissSecureAccountNudge.useMutation({
    trpc: { context: { keepalive: true } },
    onSettled: () => void utils.user.secureAccountNudge.invalidate(),
  });
  const [isCreating, setIsCreating] = useState(false);
  const [isAnswered, setIsAnswered] = useState(false);

  const later = async (): Promise<void> => {
    setIsAnswered(true);
    dismiss.mutate({});
    // A mount refetch already in flight would land after this and bring the
    // offer back, so it is cancelled before the cache is written.
    await utils.user.secureAccountNudge.cancel({});
    utils.user.secureAccountNudge.setData({}, (previous) =>
      previous ? { ...previous, offer: false } : previous,
    );
  };

  const setUpTwoStep = async (): Promise<void> => {
    await later();
    host.navigate(SECURITY_SETTINGS);
  };

  const createPasskey = async (): Promise<void> => {
    setIsCreating(true);
    try {
      const outcome = await host.registerPasskey();
      if (outcome.ok) {
        setIsAnswered(true);
        host.succeeded({ title: "Passkey created" });
        await utils.user.secureAccountNudge.invalidate();
        return;
      }
      // Closing the device's own prompt is the same decision as "Not now".
      if (!outcome.cancelled) {
        host.failed({
          error: new Error("passkey registration did not complete"),
          fallbackTitle: "That passkey wasn't created",
          description:
            "The attempt didn't finish. You can add one later from your account settings.",
        });
      }
      await later();
    } finally {
      setIsCreating(false);
    }
  };

  return {
    offer,
    ssoGoverned,
    isAnswered,
    isCreating,
    later,
    setUpTwoStep,
    createPasskey,
  };
}

/** A governed account is offered no passkey, and nothing at all when that was the whole offer. */
function withoutGovernedPasskey<T extends { offer: boolean; passkey: boolean; twoStep: boolean }>(
  offer: T | undefined,
  governed: boolean,
): T | undefined {
  if (!offer || !governed) return offer;
  return { ...offer, passkey: false, offer: offer.offer && offer.twoStep };
}
