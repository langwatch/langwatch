import {
  Badge,
  Button,
  Card,
  Heading,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { RandomColorAvatar } from "../../ui/elements/random-color-avatar";
import type { PendingJoinRequest } from "../../model/pending-join-request";

interface JoinRequestsTableProps {
  requests: PendingJoinRequest[];
  isAdmin: boolean;
  answeringId: string | null;
  onApprove: (joinRequestId: string) => void;
  onReject: (joinRequestId: string) => void;
}

/**
 * People waiting to join, in the members area beside the invitations (D12).
 *
 * One panel, two directions: an invitation is the organization reaching out,
 * a request is somebody reaching in, and an admin answers both in the same
 * place. Splitting them across two screens would make "who is waiting on me?"
 * a question with two answers.
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
  if (requests.length === 0) {
    return null;
  }

  return (
    <VStack align="start" gap={4} paddingTop={4} width="full">
      <Heading>Requests to join</Heading>
      <Text color="fg.muted" fontSize="sm">
        People with a verified address on your domain who asked to join.
        Approving adds them with your default role.
      </Text>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader width="56px" />
                <Table.ColumnHeader>Who is asking</Table.ColumnHeader>
                <Table.ColumnHeader>Domain</Table.ColumnHeader>
                <Table.ColumnHeader>Asked</Table.ColumnHeader>
                <Table.ColumnHeader>Lapses</Table.ColumnHeader>
                <Table.ColumnHeader width="180px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
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
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

function JoinRequestRow({
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
    <Table.Row data-testid="join-request-row">
      <Table.Cell>
        <RandomColorAvatar size="2xs" name={request.name} />
      </Table.Cell>
      <Table.Cell>{request.name}</Table.Cell>
      <Table.Cell>
        <Badge>{request.domain}</Badge>
      </Table.Cell>
      <Table.Cell>{formatDay(request.requestedAt)}</Table.Cell>
      <Table.Cell>
        {request.expiresAt ? formatDay(request.expiresAt) : "—"}
      </Table.Cell>
      <Table.Cell>
        {isAdmin ? (
          <HStack gap={2} justifyContent="flex-end">
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
        ) : null}
      </Table.Cell>
    </Table.Row>
  );
}

/** Spelled out, never abbreviated: "24 Aug 2026", not "24/08". */
function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
