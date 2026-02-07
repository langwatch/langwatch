import {
  Card,
  Heading,
  Table,
  VStack,
} from "@chakra-ui/react";
import type { INVITE_STATUS, OrganizationUserRole } from "@prisma/client";
import { useMemo } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { orgRoleOptions } from "../settings/OrganizationUserRoleField";
import { WaitingApprovalActions } from "./WaitingApprovalActions";

export interface WaitingApprovalInvite {
  id: string;
  email: string;
  role: OrganizationUserRole;
  status: INVITE_STATUS;
  requestedBy: string | null;
  requestedByUser: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
}

interface PendingApprovalSectionProps {
  invites: WaitingApprovalInvite[];
  isAdmin: boolean;
  currentUserId: string;
  onApprove: (inviteId: string) => void;
  onReject: (inviteId: string) => void;
}

/**
 * Renders the "Pending Approval" section on the members page.
 * Non-admins see only their own requests; admins see all requests.
 */
export function PendingApprovalSection({
  invites,
  isAdmin,
  currentUserId,
  onApprove,
  onReject,
}: PendingApprovalSectionProps) {
  const visibleInvites = useMemo(() => {
    if (isAdmin) {
      return invites;
    }
    return invites.filter((invite) => invite.requestedBy === currentUserId);
  }, [invites, isAdmin, currentUserId]);

  if (visibleInvites.length === 0) {
    return null;
  }

  return (
    <VStack align="start" gap={4} paddingTop={4} width="full">
      <Heading>Pending Approval</Heading>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader width="56px" />
                <Table.ColumnHeader>Email</Table.ColumnHeader>
                <Table.ColumnHeader>Role</Table.ColumnHeader>
                {isAdmin && (
                  <Table.ColumnHeader>Requested By</Table.ColumnHeader>
                )}
                <Table.ColumnHeader>Actions</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visibleInvites.map((invite) => (
                <Table.Row key={invite.id}>
                  <Table.Cell>
                    <RandomColorAvatar size="2xs" name={invite.email} />
                  </Table.Cell>
                  <Table.Cell>{invite.email}</Table.Cell>
                  <Table.Cell>
                    {orgRoleOptions.find((o) => o.value === invite.role)
                      ?.label ?? invite.role}
                  </Table.Cell>
                  {isAdmin && (
                    <Table.Cell>
                      {invite.requestedByUser?.name ?? "Unknown"}
                    </Table.Cell>
                  )}
                  <Table.Cell>
                    <WaitingApprovalActions
                      isAdmin={isAdmin}
                      inviteId={invite.id}
                      onApprove={onApprove}
                      onReject={onReject}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}
