// The seat-quote modal is `@langwatch/workflow-browser`'s singleton store; see
// `use-license-enforcement.ts` for why the address travels and the modal does not.
import { useLentHooks } from "@langwatch/browser-host/lent";
import { UpgradeModalToken } from "@langwatch/enterprise-licensing-client";
import type { SeatRequest } from "@langwatch/organization-contract";
import { useState } from "react";

import { api } from "./organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "./organization-feedback.ts";

/**
 * Seat requests for one organization: the open list, how a seat is approved here, and the two
 * answers. A live Stripe seat subscription expands first through the seats modal, then approves.
 * Spec: modules/organization/specs/seat-requests.feature
 */
export function useSeatRequests({
  organizationId,
  canView,
  canManage,
}: {
  organizationId: string;
  canView: boolean;
  canManage: boolean;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const upgradeModal = useLentHooks(UpgradeModalToken);
  const utils = api.useUtils();
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  const open = api.seatRequest.listOpen.useQuery(
    { organizationId },
    { enabled: canView && !!organizationId },
  );
  const approveMutation = api.seatRequest.approve.useMutation();
  const declineMutation = api.seatRequest.decline.useMutation();
  const expandSeatsMutation = api.subscription.addTeamMemberOrEvents.useMutation();

  const refresh = () => {
    void utils.seatRequest.listOpen.invalidate();
    void utils.organization.getDirectoryCounts.invalidate();
    void utils.licenseEnforcement.checkLimit.invalidate();
  };

  const run = async ({
    request,
    act,
    title,
    fallbackTitle,
  }: {
    request: SeatRequest;
    act: () => Promise<unknown>;
    title: string;
    fallbackTitle: string;
  }) => {
    setAnsweringId(request.id);
    try {
      await act();
      toaster.create({ title, type: "success", duration: 5000 });
      refresh();
    } catch (error) {
      showErrorToast({ error, fallbackTitle });
    } finally {
      setAnsweringId(null);
    }
  };

  const approveNow = (request: SeatRequest) =>
    run({
      request,
      act: () => approveMutation.mutateAsync({ organizationId, seatRequestId: request.id }),
      title: `${request.name ?? request.email} has a full seat`,
      fallbackTitle: "Couldn't approve the seat request",
    });

  const approve = (request: SeatRequest) => {
    const path = open.data?.approvalPath;
    if (open.data?.seatFree || path?.kind !== "stripe_seats") {
      void approveNow(request);
      return;
    }
    upgradeModal?.openSeats({
      organizationId,
      currentSeats: path.currentSeats,
      newSeats: path.newSeats,
      onConfirm: async () => {
        try {
          await expandSeatsMutation.mutateAsync({
            organizationId,
            plan: path.planType,
            upgradeMembers: true,
            upgradeTraces: false,
            totalMembers: path.newSeats,
            totalTraces: 0,
          });
        } catch (error) {
          showErrorToast({ error, fallbackTitle: "Couldn't add the seat" });
          return;
        }
        // The seat is bought whether or not the approval lands; reread the totals either way.
        refresh();
        await approveNow(request);
      },
    });
  };

  const decline = (request: SeatRequest) =>
    void run({
      request,
      act: () => declineMutation.mutateAsync({ organizationId, seatRequestId: request.id }),
      title: "Seat request declined",
      fallbackTitle: "Couldn't decline the seat request",
    });

  return {
    requests: open.data?.requests ?? [],
    seatFree: open.data?.seatFree ?? false,
    approvalPath: open.data?.approvalPath,
    canManage,
    answeringId,
    approve,
    decline,
  };
}
