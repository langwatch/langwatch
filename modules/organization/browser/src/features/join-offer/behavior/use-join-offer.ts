import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../behavior/organization-api.ts";
import { useShowErrorToast } from "../../../behavior/organization-feedback.ts";
import { joinOfferView, type JoinOfferView } from "../model/join-offer.ts";

type JoinOrigin = "web" | "cli";

/** The offer, the waiting state and the answers a person can give, as props. */
export function useJoinOffer({
  currentOrganizationId,
  origin = "web",
}: {
  currentOrganizationId: string | null;
  origin?: JoinOrigin;
}): {
  view: JoinOfferView | null;
  asking: boolean;
  dismissing: boolean;
  accepting: boolean;
  ask: (organizationId: string) => void;
  dismiss: (onDismissed?: () => void) => void;
  accept: (inviteCode: string) => void;
  setInvitationAside: () => void;
  checkAgain: () => void;
} {
  // Leading with an invitation and walking through an automatic door are the
  // welcome screen's alone: a dashboard has an organization in view (ADR-171 v6).
  const onboarding = currentOrganizationId === null;
  const offer = api.joinRequests.offer.useQuery();
  const mine = api.joinRequests.mine.useQuery();
  const invitations = api.invite.pendingForMe.useQuery({}, { enabled: onboarding });
  const dismissOffer = api.joinRequests.dismissOffer.useMutation();
  const askToJoin = api.joinRequests.request.useMutation();
  const acceptInvite = api.invite.acceptInvite.useMutation();
  const utils = api.useUtils();
  const showErrorToast = useShowErrorToast();
  // For this visit only: the invitation still stands, so nothing lasting is recorded.
  const [invitationSetAside, setInvitationSetAside] = useState(false);

  // A failed read is not an empty one: it may hide the invitation, so the door stays shut.
  const noInvitation = invitations.isSuccess && invitations.data.length === 0;
  const admitting = useAutomaticAdmission({
    admit: onboarding && noInvitation && offer.data?.outcome === "auto",
    origin,
  });

  const ask = useCallback(
    (organizationId: string) =>
      askToJoin.mutate(
        { organizationId, origin },
        {
          onSuccess: () => {
            void utils.joinRequests.mine.invalidate();
            void utils.joinRequests.offer.invalidate();
          },
          onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't ask to join" }),
        },
      ),
    [askToJoin, origin, utils, showErrorToast],
  );

  const dismiss = useCallback(
    (onDismissed?: () => void) =>
      dismissOffer.mutate(
        {},
        {
          onSuccess: () => {
            void utils.joinRequests.offer.invalidate();
            onDismissed?.();
          },
          onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save that" }),
        },
      ),
    [dismissOffer, utils, showErrorToast],
  );

  const accept = useCallback(
    (inviteCode: string) =>
      acceptInvite.mutate(
        { inviteCode },
        {
          onSuccess: () => {
            void utils.organization.getAll.invalidate();
            void utils.invite.pendingForMe.invalidate();
            // Accepting withdrew any open request; the cached one must not bring the wait back.
            void utils.joinRequests.mine.invalidate();
            void utils.joinRequests.offer.invalidate();
          },
          onError: (error) => {
            showErrorToast({ error, fallbackTitle: "Couldn't accept the invitation" });
            // A withdrawn invitation drops off on the re-read instead of failing again.
            void utils.invite.pendingForMe.invalidate();
          },
        },
      ),
    [acceptInvite, utils, showErrorToast],
  );

  const checkAgain = useCallback(() => void utils.joinRequests.mine.invalidate(), [utils]);

  const settled = !offer.isPending && !mine.isPending && !(onboarding && invitations.isPending);
  const view = settled
    ? joinOfferView({
        decision: offer.data,
        waitingOn: mine.data ?? [],
        currentOrganizationId,
        invitation: onboarding && !invitationSetAside ? (invitations.data?.[0] ?? null) : null,
        askHeldDown: invitationSetAside || (onboarding && invitations.isError),
        admitting,
      })
    : null;

  return {
    view,
    asking: askToJoin.isPending,
    dismissing: dismissOffer.isPending,
    accepting: acceptInvite.isPending,
    ask,
    dismiss,
    accept,
    setInvitationAside: () => setInvitationSetAside(true),
    checkAgain,
  };
}

/**
 * Walks through an automatic door once per mount: a second admission would be the same request
 * twice, refused as already pending. Answers whether the "one moment" screen should stay up; a
 * refused admission says why and steps aside so the screen beneath is reachable.
 */
function useAutomaticAdmission({ admit, origin }: { admit: boolean; origin: JoinOrigin }): boolean {
  const admitAutomatically = api.joinRequests.admitAutomatically.useMutation();
  const utils = api.useUtils();
  const showErrorToast = useShowErrorToast();
  const fired = useRef(false);

  useEffect(() => {
    if (!admit || fired.current) return;
    fired.current = true;
    admitAutomatically.mutate(
      { origin },
      {
        onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't join just now" }),
        onSettled: () => {
          void utils.organization.getAll.invalidate();
          void utils.joinRequests.offer.invalidate();
          void utils.joinRequests.mine.invalidate();
        },
      },
    );
  }, [admit, origin, admitAutomatically, utils, showErrorToast]);

  return admit && !admitAutomatically.isError;
}
