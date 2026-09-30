import { Button, HStack, Text } from "@chakra-ui/react";

import { readableDate } from "../../model/display-formatters.ts";
import type { PendingJoinRequest } from "../../model/pending-join-request.ts";
import { IdentityChip, IdentityRow, IdentityRowList } from "../elements/identity-row.tsx";

interface JoinRequestsTableProps {
  requests: PendingJoinRequest[];
  isAdmin: boolean;
  answeringId: string | null;
  onApprove: (joinRequestId: string) => void;
  onReject: (joinRequestId: string) => void;
}

/**
 * People waiting to join, beside the invitations (D12). Approve has no role
 * picker: it grants the default role, a formal invitation owns roles and
 * teams. Reject asks for no reason.
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

/** Exported because somebody asking to join is one cut of the Directory's single list of people. */
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
      name={request.name}
      // The domain is what was matched; the local part is not the organization's business yet.
      address={null}
      data-testid="join-request-row"
      chips={
        <>
          <IdentityChip label={request.domain} title="The domain their verified address is on." />
          <Text fontSize="xs" color="fg.muted">
            Asked {formatDay(request.requestedAt)}
            {request.expiresAt ? `, lapses ${formatDay(request.expiresAt)}` : ""}
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

/** Spelled out, never abbreviated: "24 Aug 2026", not "24/08". */
function formatDay(date: string): string {
  return readableDate(date).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
