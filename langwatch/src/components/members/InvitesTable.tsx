import {
  Badge,
  Box,
  Card,
  Heading,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Mail, MoreVertical, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import type { RouterOutputs } from "~/utils/api";
import { orgRoleOptions } from "../settings/OrganizationUserRoleField";
import { WaitingApprovalActions } from "./WaitingApprovalActions";

type OrganizationInvite =
  RouterOutputs["organization"]["getOrganizationPendingInvites"][number];

interface InvitesTableProps {
  waitingApprovalInvites: OrganizationInvite[];
  sentInvites: OrganizationInvite[];
  isAdmin: boolean;
  currentUserId: string;
  teams: Array<{ id: string; name: string; slug: string }>;
  onApprove: (inviteId: string) => void;
  onReject: (inviteId: string) => void;
  onViewInviteLink: (inviteCode: string, email: string) => void;
  onDeleteInvite: (inviteId: string) => void;
}

export function InvitesTable({
  waitingApprovalInvites,
  sentInvites,
  isAdmin,
  currentUserId,
  teams,
  onApprove,
  onReject,
  onViewInviteLink,
  onDeleteInvite,
}: InvitesTableProps) {
  const visibleWaitingApprovalInvites = useMemo(() => {
    if (isAdmin) {
      return waitingApprovalInvites;
    }
    return waitingApprovalInvites.filter(
      (invite) => invite.requestedBy === currentUserId,
    );
  }, [waitingApprovalInvites, isAdmin, currentUserId]);

  const orderedInvites = useMemo(
    () => [...visibleWaitingApprovalInvites, ...sentInvites],
    [visibleWaitingApprovalInvites, sentInvites],
  );

  if (orderedInvites.length === 0) {
    return null;
  }

  return (
    <VStack align="start" gap={4} paddingTop={4} width="full">
      <Heading>Invites</Heading>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader width="56px" />
                <Table.ColumnHeader>Email</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Role</Table.ColumnHeader>
                <Table.ColumnHeader>Teams</Table.ColumnHeader>
                <Table.ColumnHeader width="60px"></Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {orderedInvites.map((invite) => {
                const isWaitingApproval =
                  invite.status === "WAITING_APPROVAL";
                const roleLabel =
                  orgRoleOptions.find((o) => o.value === invite.role)?.label ??
                  invite.role;

                return (
                  <Table.Row key={invite.id}>
                    <Table.Cell>
                      <RandomColorAvatar size="2xs" name={invite.email} />
                    </Table.Cell>
                    <Table.Cell>{invite.email}</Table.Cell>
                    <Table.Cell>
                      {isWaitingApproval ? (
                        <Badge size="sm" variant="surface" colorPalette="orange">
                          Pending Approval
                        </Badge>
                      ) : (
                        <Badge size="sm" variant="surface">
                          Invited
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>{roleLabel}</Table.Cell>
                    <Table.Cell>
                      <TeamIdsDisplay teamIds={invite.teamIds} teams={teams} />
                    </Table.Cell>
                    <Table.Cell>
                      <Box
                        width="full"
                        height="full"
                        display="flex"
                        justifyContent="end"
                      >
                        {isWaitingApproval ? (
                          <WaitingApprovalActions
                            isAdmin={isAdmin}
                            inviteId={invite.id}
                            onApprove={onApprove}
                            onReject={onReject}
                          />
                        ) : (
                          <Menu.Root>
                            <Menu.Trigger>
                              <MoreVertical size={16} />
                            </Menu.Trigger>
                            <Menu.Content>
                              <Menu.Item
                                value="view-link"
                                onClick={() =>
                                  onViewInviteLink(
                                    invite.inviteCode,
                                    invite.email,
                                  )
                                }
                              >
                                <Mail size={16} />
                                View invite link
                              </Menu.Item>
                              {isAdmin && (
                                <Menu.Item
                                  value="delete"
                                  color="red.500"
                                  onClick={() => onDeleteInvite(invite.id)}
                                >
                                  <Trash2 size={16} />
                                  Delete
                                </Menu.Item>
                              )}
                            </Menu.Content>
                          </Menu.Root>
                        )}
                      </Box>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

interface TeamIdsDisplayProps {
  teamIds: string;
  teams: Array<{ id: string; name: string; slug: string }>;
}

const TeamIdsDisplay = ({ teamIds, teams }: TeamIdsDisplayProps) => {
  if (!teamIds) {
    return null;
  }

  const teamIdList = teamIds
    .split(",")
    .map((teamId) => teamId.trim())
    .filter(Boolean);

  if (teamIdList.length === 0) {
    return null;
  }

  return (
    <HStack gap={2} flexWrap="wrap">
      {teamIdList.map((teamId) => {
        const team = teams.find((candidate) => candidate.id === teamId);

        if (!team) return null;

        return (
          <Link href={`/settings/teams/${team.slug}`} key={teamId}>
            <Badge size="sm" variant="surface">
              {team.name}
            </Badge>
          </Link>
        );
      })}
    </HStack>
  );
};
