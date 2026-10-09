import { Button, HStack, Text } from "@chakra-ui/react";
import type { JoinerRole } from "@langwatch/identity";
import {
  IdentityChip,
  IdentityRow,
  IdentityRowList,
} from "~/components/access/IdentityRow";
import { orgRoleOptions } from "~/components/settings/OrganizationUserRoleField";

/** One waiting request, as the panel needs it. The requester's ADDRESS is not
 *  here — the domain is what was matched and what an admin is deciding on. */
export interface PendingJoinRequest {
  joinRequestId: string;
  name: string;
  domain: string;
  requestedAt: Date;
  expiresAt: Date | null;
  /** The seat an approval lands this request in (ADR-143 v6). Shown, never
   *  edited: approval carries no role choice. */
  seat: JoinerRole;
}

interface JoinRequestsTableProps {
  requests: PendingJoinRequest[];
  isAdmin: boolean;
  answeringId: string | null;
  onApprove: (joinRequestId: string) => void;
  onReject: (joinRequestId: string) => void;
}

/**
 * People waiting to join, in a tab of the members area beside the
 * invitations (D12).
 *
 * One area, two directions: an invitation is the organization reaching out, a
 * request is somebody reaching in, and an admin answers both in the same
 * place. They are two tabs rather than two stacked tables now, so "who is
 * waiting on me?" is a number on a tab rather than a scroll.
 *
 * Approve carries no role picker, and that absence is deliberate rather than
 * unfinished: an approval grants the organization's default role, and an
 * admin who wants to hand over more sends a formal invitation — which is the
 * flow that owns roles and teams. Reject asks for no reason, because an admin
 * who has to justify a refusal is an admin who hesitates to make one.
 */
export function JoinRequestsTable({
  requests,
  isAdmin,
  answeringId,
  onApprove,
  onReject,
}: JoinRequestsTableProps) {
  return (
    <IdentityRowList
      data-testid="join-requests-list"
      empty="Nobody is waiting to join. People with a verified address on your domain can ask, if your joining policy allows it."
    >
      {requests.map((request) => (
        <JoinRequestRow
          key={request.joinRequestId}
          request={request}
          isAdmin={isAdmin}
          answering={answeringId === request.joinRequestId}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </IdentityRowList>
  );
}

/**
 * Exported for the same reason the invitation row is: somebody asking to join
 * is one cut of the Directory's single list of people, not a table apart.
 */
export function JoinRequestRow({
  request,
  isAdmin,
  answering,
  onApprove,
  onReject,
}: {
  request: PendingJoinRequest;
  isAdmin: boolean;
  answering: boolean;
  onApprove: (joinRequestId: string) => void;
  onReject: (joinRequestId: string) => void;
}) {
  return (
    <IdentityRow
      id={request.joinRequestId}
      name={request.name}
      // The domain is what was matched; the local part is not the
      // organization's business until this person is a member.
      address={null}
      data-testid="join-request-row"
      chips={
        <>
          <IdentityChip
            label={request.domain}
            title="The domain their verified address is on."
          />
          <IdentityChip
            label={seatLabel(request.seat)}
            title="The seat they land in if you approve. A request made from the terminal lands as a Developer; one made on the web lands your organization's joiner seat."
          />
          <Text fontSize="xs" color="fg.muted">
            Asked {formatDay(request.requestedAt)}
            {request.expiresAt
              ? `, lapses ${formatDay(request.expiresAt)}`
              : ""}
          </Text>
        </>
      }
      trailing={
        isAdmin ? (
          <HStack gap={2}>
            <Button
              size="xs"
              variant="outline"
              loading={answering}
              onClick={() => onReject(request.joinRequestId)}
            >
              Reject
            </Button>
            <Button
              size="xs"
              colorPalette="orange"
              loading={answering}
              onClick={() => onApprove(request.joinRequestId)}
            >
              Approve
            </Button>
          </HStack>
        ) : null
      }
    />
  );
}

/** The same word the invitations tab uses for the seat. */
function seatLabel(seat: JoinerRole): string {
  return orgRoleOptions.find((option) => option.value === seat)?.label ?? seat;
}

/** Spelled out, never abbreviated: "24 Aug 2026", not "24/08". */
function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
