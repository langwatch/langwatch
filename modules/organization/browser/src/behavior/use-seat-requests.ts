import type {
  SeatApprovalCompletion,
  SeatApprovalWithSeat,
  SeatRequest,
} from "@langwatch/organization-contract";
import { useEffect, useRef, useState } from "react";

import { api } from "./organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "./organization-feedback.ts";
import { reportUnexpected } from "./report-unexpected.ts";
import { SEAT_PAYMENT_POLL_MS } from "./use-seat-role-change.ts";

/** An approval waiting on the Stripe page its seat charge opened. */
export type WaitingSeatApproval = { request: SeatRequest; paymentRef: string; url: string };

type CompleteApproval = (input: {
  organizationId: string;
  seatRequestId: string;
  paymentRef: string;
}) => Promise<SeatApprovalCompletion>;

/** Asks once whether the seat payment landed; a failed ask leaves the approval waiting. */
async function askPaid({
  complete,
  organizationId,
  waiting,
}: {
  complete: CompleteApproval;
  organizationId: string;
  waiting: WaitingSeatApproval;
}): Promise<SeatApprovalCompletion> {
  try {
    return await complete({
      organizationId,
      seatRequestId: waiting.request.id,
      paymentRef: waiting.paymentRef,
    });
  } catch (error) {
    reportUnexpected(error, { action: "completeSeatApproval" });
    return { status: "waiting" };
  }
}

/** While an approval waits on its payment: asks on window focus and every few seconds. */
function useWaitForSeatPayment({
  organizationId,
  waiting,
  complete,
  onSettled,
}: {
  organizationId: string;
  waiting: WaitingSeatApproval | undefined;
  complete: CompleteApproval;
  onSettled: (settled: SeatApprovalCompletion, waiting: WaitingSeatApproval) => void;
}) {
  // The latest callbacks, read by the timer without restarting it on every render.
  const latest = useRef({ complete, onSettled, waiting });
  useEffect(() => {
    latest.current = { complete, onSettled, waiting };
  });
  const paymentRef = waiting?.paymentRef;
  useEffect(() => {
    if (paymentRef === undefined) return;
    let live = true;
    let asking = false;
    const ask = async () => {
      const current = latest.current.waiting;
      if (asking || !live || !current) return;
      asking = true;
      const settled = await askPaid({
        complete: latest.current.complete,
        organizationId,
        waiting: current,
      });
      asking = false;
      if (!live || settled.status === "waiting") return;
      live = false;
      latest.current.onSettled(settled, current);
    };
    const onFocus = () => void ask();
    const timer = setInterval(onFocus, SEAT_PAYMENT_POLL_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [paymentRef, organizationId]);
}

/**
 * Seat requests for one organization: the open list and the two answers. With no seat free on a
 * live Stripe seat subscription, Approve buys the seat in the same click, opening Stripe's page
 * only when Stripe needs the customer. Spec: modules/organization/specs/seat-requests.feature
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
  const utils = api.useUtils();
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<WaitingSeatApproval | undefined>(undefined);

  const open = api.seatRequest.listOpen.useQuery(
    { organizationId },
    { enabled: canView && !!organizationId },
  );
  const approveMutation = api.seatRequest.approve.useMutation();
  const approveWithSeatMutation = api.seatRequest.approveWithSeat.useMutation();
  const completeMutation = api.seatRequest.completeSeatApproval.useMutation();
  const declineMutation = api.seatRequest.decline.useMutation();

  const refresh = () => {
    void utils.seatRequest.listOpen.invalidate();
    void utils.organization.getDirectoryCounts.invalidate();
    void utils.licenseEnforcement.checkLimit.invalidate();
    void utils.limits.getUsage.invalidate();
  };

  const nameOf = (request: SeatRequest) => request.name ?? request.email;

  const approved = ({ request, seatAdded }: { request: SeatRequest; seatAdded: boolean }) => {
    toaster.create({
      title: `${nameOf(request)} has a full seat`,
      ...(seatAdded ? { description: "1 seat added." } : {}),
      type: "success",
      duration: 5000,
    });
    refresh();
  };

  useWaitForSeatPayment({
    organizationId,
    waiting,
    complete: completeMutation.mutateAsync,
    onSettled: (settled, settledWaiting) => {
      setWaiting(undefined);
      if (settled.status === "approved") {
        approved({ request: settledWaiting.request, seatAdded: true });
        return;
      }
      toaster.create({ title: "The seat payment was not completed", type: "error" });
      refresh();
    },
  });

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
      title: `${nameOf(request)} has a full seat`,
      fallbackTitle: "Couldn't approve the seat request",
    });

  /** One click: the seat bought and the request approved, or the Stripe page it waits on. */
  const approveWithSeat = async (request: SeatRequest) => {
    setAnsweringId(request.id);
    let answer: SeatApprovalWithSeat;
    try {
      answer = await approveWithSeatMutation.mutateAsync({
        organizationId,
        seatRequestId: request.id,
      });
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't add the seat" });
      // A seat may have been bought before the approval was refused; reread the totals.
      refresh();
      return;
    } finally {
      setAnsweringId(null);
    }
    if (answer.status === "approved") {
      approved({ request, seatAdded: answer.seatAdded });
      return;
    }
    setWaiting({ request, paymentRef: answer.paymentRef, url: answer.url });
    window.open(answer.url, "_blank", "noopener");
  };

  const approve = (request: SeatRequest) => {
    const path = open.data?.approvalPath;
    if (open.data?.seatFree || path?.kind !== "stripe_seats") {
      void approveNow(request);
      return;
    }
    void approveWithSeat(request);
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
    /** The request whose seat payment is still open in Stripe's page. */
    waitingId: waiting?.request.id ?? null,
    waitingUrl: waiting?.url ?? null,
    approve,
    decline,
  };
}
