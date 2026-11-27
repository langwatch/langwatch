import type {
  OpenSeatRequests,
  SeatApprovalCompletion,
  SeatApprovalWithSeat,
  SeatRequest,
} from "@langwatch/organization-contract";
import { useEffect, useRef, useState } from "react";

import { readHandledError } from "./handled-error-form.tsx";
import { api } from "./organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "./organization-feedback.ts";
import { askOnReturn, paymentAsker } from "./payment-asker.ts";
import { reportUnexpected } from "./report-unexpected.ts";

/** An approval waiting on the Stripe page its seat charge opened, in the organization it began. */
export type WaitingSeatApproval = {
  organizationId: string;
  request: SeatRequest;
  paymentRef: string;
  url: string;
};

type CompleteApproval = (input: {
  organizationId: string;
  seatRequestId: string;
  paymentRef: string;
}) => Promise<SeatApprovalCompletion>;

/** What one ask settles to; `closed` when the request was answered or reopened meanwhile. */
type SeatApprovalSettled = SeatApprovalCompletion | { status: "closed" };

/** Asks once whether the seat payment landed; a failed ask leaves the approval waiting. */
async function askPaid({
  complete,
  waiting,
}: {
  complete: CompleteApproval;
  waiting: WaitingSeatApproval;
}): Promise<SeatApprovalSettled> {
  try {
    return await complete({
      organizationId: waiting.organizationId,
      seatRequestId: waiting.request.id,
      paymentRef: waiting.paymentRef,
    });
  } catch (error) {
    if (readHandledError(error)?.code === "seat_request_not_found") return { status: "closed" };
    reportUnexpected(error, { action: "completeSeatApproval" });
    return { status: "waiting" };
  }
}

/** While an approval waits on its payment: asks each time the admin comes back to this window. */
function useWaitForSeatPayment({
  waiting,
  complete,
  onSettled,
}: {
  waiting: WaitingSeatApproval | undefined;
  complete: CompleteApproval;
  onSettled: (settled: SeatApprovalSettled, waiting: WaitingSeatApproval) => void;
}) {
  // The latest callbacks, read by the timer without restarting it on every render.
  const latest = useRef({ complete, onSettled, waiting });
  useEffect(() => {
    latest.current = { complete, onSettled, waiting };
  });
  const paymentRef = waiting?.paymentRef;
  useEffect(() => {
    const current = latest.current.waiting;
    if (paymentRef === undefined || !current) return;
    return askOnReturn(
      paymentAsker({
        ask: () => askPaid({ complete: latest.current.complete, waiting: current }),
        isSettled: (settled) => settled.status !== "waiting",
        onSettled: (settled) => latest.current.onSettled(settled, current),
      }),
    );
  }, [paymentRef]);
}

/** Why an approval stopped waiting without approving. */
function unsettledTitle({ settled, name }: { settled: SeatApprovalSettled; name: string }): string {
  return settled.status === "closed"
    ? `The seat request from ${name} was already answered`
    : "The seat payment was not completed";
}

/** Approve buys the seat only with none free on a live Stripe seat subscription. */
function buysSeat(open: OpenSeatRequests | undefined): boolean {
  return !open?.seatFree && open?.approvalPath?.kind === "stripe_seats";
}

/** The waiting approval when it began in this organization. */
function waitingIn({
  waiting,
  organizationId,
}: {
  waiting: WaitingSeatApproval | undefined;
  organizationId: string;
}): WaitingSeatApproval | undefined {
  return waiting?.organizationId === organizationId ? waiting : undefined;
}

/** The approval still waiting on its payment when it is not this request's own. */
function otherWaiting({
  waiting,
  request,
}: {
  waiting: WaitingSeatApproval | undefined;
  request: SeatRequest;
}): WaitingSeatApproval | undefined {
  return waiting && waiting.request.id !== request.id ? waiting : undefined;
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
  const [waitingAnywhere, setWaiting] = useState<WaitingSeatApproval | undefined>(undefined);
  const waiting = waitingIn({ waiting: waitingAnywhere, organizationId });

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

  // Observed in whichever organization it began, so paying it after a switch still clears it.
  useWaitForSeatPayment({
    waiting: waitingAnywhere,
    complete: completeMutation.mutateAsync,
    onSettled: (settled, settledWaiting) => {
      setWaiting(undefined);
      if (settled.status === "approved") {
        approved({ request: settledWaiting.request, seatAdded: true });
        return;
      }
      toaster.create({
        title: unsettledTitle({ settled, name: nameOf(settledWaiting.request) }),
        type: "error",
      });
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
    // One seat payment at a time: a second would leave the first approval unfinished once paid.
    const other = otherWaiting({ waiting: waitingAnywhere, request });
    if (other) {
      toaster.create({
        title: `Finish the seat payment for ${nameOf(other.request)} first`,
        type: "error",
      });
      return;
    }
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
    setWaiting({ organizationId, request, paymentRef: answer.paymentRef, url: answer.url });
    window.open(answer.url, "_blank", "noopener");
  };

  const approve = (request: SeatRequest) =>
    void (buysSeat(open.data) ? approveWithSeat(request) : approveNow(request));

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
