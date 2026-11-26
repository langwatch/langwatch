/**
 * A Lite Member's own request for a full seat, asked from a refusal: where it stands and the
 * one action that sends it. Spec: modules/organization/specs/seat-requests.feature
 */

import type { MyAccessRequest } from "@langwatch/organization-contract";
import { useState } from "react";

import { useOrganizationHost } from "../model/organization-host.ts";
import { api } from "./organization-api.ts";
import { useShowErrorToast } from "./organization-feedback.ts";

export type AccessRequestStatus = MyAccessRequest["status"];

export function useAccessRequest({ reason }: { reason?: string }) {
  const host = useOrganizationHost();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const organizationId = host.scope().organizationId ?? "";
  const offered = host.isLiteMember() && organizationId !== "";

  const mine = api.seatRequest.myAccessRequest.useQuery({ organizationId }, { enabled: offered });
  const requestAccess = api.seatRequest.requestAccess.useMutation();
  // The answer to this page's own press, ahead of the reread that follows it.
  const [sent, setSent] = useState<MyAccessRequest | undefined>(undefined);

  const send = async () => {
    try {
      const answer = await requestAccess.mutateAsync({
        organizationId,
        ...(reason ? { reason } : {}),
      });
      setSent(answer);
      void utils.seatRequest.myAccessRequest.invalidate();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't send your access request" });
    }
  };

  return {
    offered,
    status: (sent?.status ?? mine.data?.status ?? "none") satisfies AccessRequestStatus,
    isLoading: offered && mine.isPending,
    isSending: requestAccess.isPending,
    send,
    reload: () => window.location.reload(),
  };
}
