import { identityClient } from "@langwatch/identity-client";
import { useCallback } from "react";

import { api } from "../../../behavior/organization-api.ts";
import { useShowErrorToast } from "../../../behavior/organization-feedback.ts";
import {
  type JoinInsteadOrganization,
  joinInsteadView,
  type JoinInsteadView,
} from "../model/join-instead.ts";

/**
 * The organization form's way back to the team: the same request the offer
 * makes, or the automatic door where the organization opened one. The wait
 * that follows is the join offer's to draw.
 */
export function useJoinInstead({ origin }: { origin: "web" | "cli" }): {
  view: JoinInsteadView;
  joining: boolean;
  join: (organization: JoinInsteadOrganization) => void;
} {
  const lookup = identityClient.identity.joinRequests.lookup.useQuery();
  const offer = identityClient.identity.joinRequests.offer.useQuery();
  const mine = identityClient.identity.joinRequests.mine.useQuery();
  const invitations = api.invite.pendingForMe.useQuery({});
  const askToJoin = identityClient.identity.joinRequests.request.useMutation();
  const admit = identityClient.identity.joinRequests.admitAutomatically.useMutation();
  const utils = api.useUtils();
  const joinUtils = identityClient.useUtils();
  const showErrorToast = useShowErrorToast();

  const refresh = useCallback(() => {
    void utils.organization.getAll.invalidate();
    void joinUtils.identity.joinRequests.mine.invalidate();
    void joinUtils.identity.joinRequests.offer.invalidate();
    void joinUtils.identity.joinRequests.lookup.invalidate();
  }, [utils, joinUtils]);

  const join = useCallback(
    (organization: JoinInsteadOrganization) => {
      const onError = (error: unknown) =>
        showErrorToast({ error, fallbackTitle: `Couldn't join ${organization.name}` });
      if (organization.admits === "auto") {
        admit.mutate({ origin }, { onSettled: refresh, onError });
        return;
      }
      askToJoin.mutate(
        { organizationId: organization.organizationId, origin },
        { onSuccess: refresh, onError },
      );
    },
    [admit, askToJoin, origin, refresh, showErrorToast],
  );

  // A failed invitation read may hide an invitation, so the way back stays shut.
  const settled = lookup.isSuccess && offer.isSuccess && mine.isSuccess && invitations.isSuccess;
  const view: JoinInsteadView = settled
    ? joinInsteadView({
        lookup: lookup.data,
        offer: offer.data,
        waitingOn: mine.data,
        invitationStands: invitations.data.length > 0,
      })
    : { kind: "hidden" };

  return { view, joining: askToJoin.isPending || admit.isPending, join };
}
