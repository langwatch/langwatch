import { Link } from "@langwatch/browser-host/link";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import { formatPrice } from "@langwatch/enterprise-billing-contract";
import type { SeatApprovalPath, SeatRequest } from "@langwatch/organization-contract";
import { readableDate } from "@langwatch/time";

import { IdentityChip, IdentityRow, IdentityRowList } from "../elements/identity-row.tsx";

const SOURCE_LABEL: Record<SeatRequest["source"], { label: string; title: string }> = {
  pending: {
    label: "No access",
    title: "They signed in, but no full or Lite Member seat was free, so they are waiting.",
  },
  lite: {
    label: "Lite Member",
    title: "No full seat was free, so they got Lite Member access until you approve.",
  },
  idp_refused: {
    label: "Not signed in",
    title: "Their sign-in was refused before they reached LangWatch.",
  },
  requested: {
    label: "Asked for access",
    title: "They pressed Request access when a Lite Member seat stopped them.",
  },
};

/** "Approve and add a seat", priced when the subscription names its seat price. */
function approveLabel({
  seatFree,
  approvalPath,
}: {
  seatFree: boolean;
  approvalPath: SeatApprovalPath | undefined;
}): { label: string; title?: string } {
  if (seatFree || approvalPath?.kind !== "stripe_seats") return { label: "Approve" };
  const price = approvalPath.seatPrice;
  return {
    label: "Approve and add a seat",
    title: price
      ? `Adds one full seat at ${seatPriceLabel(price)} to your subscription, then approves.`
      : "Adds one full seat to your subscription, then approves.",
  };
}

/** The seat price as every other price in the product reads. */
function seatPriceLabel({ amount, currency }: { amount: number; currency: "USD" | "EUR" }): string {
  return formatPrice({ cents: Math.round(amount * 100), currency });
}

/** The one action that gives a seat when Approve cannot, worded for how the organization pays. */
const PATH_ACTION: Record<
  Exclude<SeatApprovalPath["kind"], "stripe_seats">,
  { label: string; isExternal: boolean }
> = {
  upgrade_plan: { label: "Upgrade your plan", isExternal: false },
  contact_sales: { label: "Contact LangWatch to increase your plan", isExternal: true },
  upgrade_licence: { label: "Buy more licence seats", isExternal: false },
};

/**
 * People who asked for a full seat the organization had no room for. Approve gives the seat in
 * place when one is free or the subscription adds one; otherwise the plan has to grow first.
 */
export function SeatRequestsTable({
  requests,
  seatFree,
  approvalPath,
  canManage,
  answeringId,
  waitingId = null,
  waitingUrl = null,
  onApprove,
  onDecline,
}: {
  requests: readonly SeatRequest[];
  seatFree: boolean;
  approvalPath: SeatApprovalPath | undefined;
  canManage: boolean;
  answeringId: string | null;
  /** The request whose seat payment is still open in Stripe's page, and that page. */
  waitingId?: string | null;
  waitingUrl?: string | null;
  onApprove: (request: SeatRequest) => void;
  onDecline: (request: SeatRequest) => void;
}) {
  const growFirst =
    !seatFree && approvalPath && approvalPath.kind !== "stripe_seats" ? approvalPath : null;
  const approveAction = approveLabel({ seatFree, approvalPath });

  return (
    <IdentityRowList data-testid="seat-requests-list" empty="Nobody is waiting for a seat.">
      {requests.map((request) => (
        <IdentityRow
          key={request.id}
          name={request.name}
          address={request.email}
          data-testid="seat-request-row"
          chips={
            <>
              <IdentityChip
                label={SOURCE_LABEL[request.source].label}
                title={SOURCE_LABEL[request.source].title}
                tone={request.source === "lite" ? "neutral" : "warning"}
              />
              {request.idpRefused && (
                <IdentityChip
                  label="Refused by your identity provider"
                  title="Assign them to the LangWatch app in your identity provider too, or they still cannot sign in."
                  tone="bad"
                />
              )}
              {request.reason ? (
                <Text fontSize="xs" color="fg.muted" data-testid="seat-request-reason">
                  Wants to {request.reason}
                </Text>
              ) : null}
              <Text fontSize="xs" color="fg.muted">
                Asked {formatDay(request.openedAt)}
              </Text>
            </>
          }
          trailing={
            canManage ? (
              <HStack gap={2}>
                <Button
                  size="xs"
                  variant="outline"
                  loading={answeringId === request.id}
                  onClick={() => onDecline(request)}
                >
                  Decline
                </Button>
                {growFirst ? (
                  <Link href={growFirst.url} isExternal={PATH_ACTION[growFirst.kind].isExternal}>
                    <Button size="xs" colorPalette="orange">
                      {PATH_ACTION[growFirst.kind].label}
                    </Button>
                  </Link>
                ) : null}
                {!growFirst && waitingId === request.id ? (
                  <WaitingOnPayment url={waitingUrl} />
                ) : null}
                {!growFirst && waitingId !== request.id ? (
                  <Button
                    size="xs"
                    colorPalette="orange"
                    loading={answeringId === request.id}
                    title={approveAction.title}
                    onClick={() => onApprove(request)}
                  >
                    {approveAction.label}
                  </Button>
                ) : null}
              </HStack>
            ) : null
          }
        />
      ))}
    </IdentityRowList>
  );
}

/** The row's place for Approve while the seat payment is still open in Stripe's page. */
function WaitingOnPayment({ url }: { url: string | null }) {
  return (
    <HStack gap={2} data-testid="seat-request-waiting">
      <Text fontSize="xs" color="fg.muted">
        Waiting for the seat payment
      </Text>
      {url ? (
        <Link href={url} isExternal>
          <Button size="xs" variant="outline">
            Open the payment page
          </Button>
        </Link>
      ) : null}
    </HStack>
  );
}

/** Spelled out, never abbreviated: "24 Aug 2026", not "24/08". */
function formatDay(at: number): string {
  return readableDate(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
