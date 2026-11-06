import { Link } from "@langwatch/browser-host/link";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
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
};

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
  onApprove,
  onDecline,
}: {
  requests: readonly SeatRequest[];
  seatFree: boolean;
  approvalPath: SeatApprovalPath | undefined;
  canManage: boolean;
  answeringId: string | null;
  onApprove: (request: SeatRequest) => void;
  onDecline: (request: SeatRequest) => void;
}) {
  const growFirst =
    !seatFree && approvalPath && approvalPath.kind !== "stripe_seats" ? approvalPath : null;

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
                ) : (
                  <Button
                    size="xs"
                    colorPalette="orange"
                    loading={answeringId === request.id}
                    onClick={() => onApprove(request)}
                  >
                    Approve
                  </Button>
                )}
              </HStack>
            ) : null
          }
        />
      ))}
    </IdentityRowList>
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
