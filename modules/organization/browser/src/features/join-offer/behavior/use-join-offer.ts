import { useCallback } from "react";

import { api } from "../../../behavior/organization-api.ts";
import { useShowErrorToast } from "../../../behavior/organization-feedback.ts";
import { joinOfferView, type JoinOfferView } from "../model/join-offer.ts";

/** The offer, the waiting state and the two answers a person can give, as props. */
export function useJoinOffer({ currentOrganizationId }: { currentOrganizationId: string | null }): {
  view: JoinOfferView | null;
  asking: boolean;
  dismissing: boolean;
  ask: (organizationId: string) => void;
  dismiss: (onDismissed?: () => void) => void;
  checkAgain: () => void;
} {
  const offer = api.joinRequests.offer.useQuery();
  const mine = api.joinRequests.mine.useQuery();
  const dismissOffer = api.joinRequests.dismissOffer.useMutation();
  const askToJoin = api.joinRequests.request.useMutation();
  const utils = api.useUtils();
  const showErrorToast = useShowErrorToast();

  const ask = useCallback(
    (organizationId: string) =>
      askToJoin.mutate(
        { organizationId },
        {
          onSuccess: () => {
            void utils.joinRequests.mine.invalidate();
            void utils.joinRequests.offer.invalidate();
          },
          onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't ask to join" }),
        },
      ),
    [askToJoin, utils, showErrorToast],
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

  const checkAgain = useCallback(() => void utils.joinRequests.mine.invalidate(), [utils]);

  const view =
    offer.isPending || mine.isPending
      ? null
      : joinOfferView({
          decision: offer.data,
          waitingOn: mine.data ?? [],
          currentOrganizationId,
        });

  return {
    view,
    asking: askToJoin.isPending,
    dismissing: dismissOffer.isPending,
    ask,
    dismiss,
    checkAgain,
  };
}
