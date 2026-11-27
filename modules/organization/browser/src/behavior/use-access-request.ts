/**
 * A Lite Member's own request for a full seat, asked from a refusal: where it stands and the
 * one action that sends it. Spec: modules/organization/specs/seat-requests.feature
 */

import type { MyAccessRequest, SeatRequestReason } from "@langwatch/organization-contract";
import { useState } from "react";

import { useOrganizationHost } from "../model/organization-host.ts";
import { api } from "./organization-api.ts";
import { useShowErrorToast } from "./organization-feedback.ts";

export type AccessRequestStatus = MyAccessRequest["status"];

/** The read wins once it knows of the request just sent; until then the send's own answer shows. */
function currentStatus({
  sent,
  read,
}: {
  sent: MyAccessRequest | undefined;
  read: MyAccessRequest | undefined;
}): AccessRequestStatus {
  if (!sent) return read?.status ?? "none";
  const caughtUp =
    read?.openedAt != null && sent.openedAt != null && read.openedAt >= sent.openedAt;
  return caughtUp ? read.status : sent.status;
}

export function useAccessRequest({ reason }: { reason?: SeatRequestReason }) {
  const host = useOrganizationHost();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const organizationId = host.scope().organizationId ?? "";
  const offered = host.isLiteMember() && organizationId !== "";

  const mine = api.seatRequest.myAccessRequest.useQuery({ organizationId }, { enabled: offered });
  const requestAccess = api.seatRequest.requestAccess.useMutation();
  // The answer to this page's own press, for its organization, until the reread catches up.
  const [sent, setSent] = useState<{ organizationId: string; answer: MyAccessRequest } | undefined>(
    undefined,
  );

  const send = async () => {
    try {
      const answer = await requestAccess.mutateAsync({
        organizationId,
        ...(reason ? { reason } : {}),
      });
      setSent({ organizationId, answer });
      void utils.seatRequest.myAccessRequest.invalidate();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't send your access request" });
    }
  };

  return {
    offered,
    status: currentStatus({
      sent: sent?.organizationId === organizationId ? sent.answer : undefined,
      read: mine.data,
    }) satisfies AccessRequestStatus,
    isLoading: offered && mine.isPending,
    isSending: requestAccess.isPending,
    send,
    reload: () => window.location.reload(),
  };
}
