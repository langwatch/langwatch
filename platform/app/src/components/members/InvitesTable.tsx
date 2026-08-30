import { Badge, Box, Card, Heading, HStack, IconButton, Table, VStack } from "@chakra-ui/react";
import { Mail, MoreVertical, RefreshCw, Trash2 } from "lucide-react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { Link } from "~/components/ui/link";
import { Menu } from "@langwatch/design-system/menu";
import type { RouterOutputs } from "~/utils/api";
import { orgRoleOptions } from "../settings/OrganizationUserRoleField";

type OrganizationInvite = RouterOutputs["organization"]["getOrganizationPendingInvites"][number];

interface InvitesTableProps {
  invites: OrganizationInvite[];
  isAdmin: boolean;
  teams: Array<{ id: string; name: string; slug: string }>;
  onViewInviteLink: (inviteCode: string, email: string) => void;
  onResendInvite: (inviteId: string) => void;
  onRevokeInvite: (inviteId: string) => void;
}

/**
 * Invitation states as a person sees them (D11): PENDING, EXPIRED and
 * REVOKED are all visible, with expiry dates — an expired invitation is a
 * resendable state, not a row that silently vanished.
 */
const STATUS_BADGES: Record<string, { label: string; colorPalette?: string }> = {
  PENDING: { label: "Invited" },
  EXPIRED: { label: "Expired", colorPalette: "orange" },
  REVOKED: { label: "Revoked", colorPalette: "gray" },
  ACCEPTED: { label: "Accepted", colorPalette: "green" },
  PAYMENT_PENDING: { label: "Awaiting payment", colorPalette: "orange" },
};

export function InvitesTable({
  invites,
  isAdmin,
  teams,
  onViewInviteLink,
  onResendInvite,
  onRevokeInvite,
}: InvitesTableProps) {
  if (invites.length === 0) {
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
                <Table.ColumnHeader>Expires</Table.ColumnHeader>
                <Table.ColumnHeader>Role</Table.ColumnHeader>
                <Table.ColumnHeader>Teams</Table.ColumnHeader>
                <Table.ColumnHeader width="60px"></Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {invites.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  isAdmin={isAdmin}
                  teams={teams}
                  onViewInviteLink={onViewInviteLink}
                  onResendInvite={onResendInvite}
                  onRevokeInvite={onRevokeInvite}
                />
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

interface InviteRowProps extends Omit<InvitesTableProps, "invites"> {
  invite: OrganizationInvite;
}

const InviteRow = ({
  invite,
  isAdmin,
  teams,
  onViewInviteLink,
  onResendInvite,
  onRevokeInvite,
}: InviteRowProps) => {
  const displayStatus = invite.displayStatus;
  const badge = STATUS_BADGES[displayStatus] ?? STATUS_BADGES.PENDING!;
  const roleLabel = orgRoleOptions.find((o) => o.value === invite.role)?.label ?? invite.role;
  const isOpen = displayStatus === "PENDING" || displayStatus === "EXPIRED";
  const canResend = isAdmin && isOpen;
  const canViewLink = displayStatus === "PENDING";

  return (
    <Table.Row>
      <Table.Cell>
        <RandomColorAvatar size="2xs" name={invite.email} />
      </Table.Cell>
      <Table.Cell>{invite.email}</Table.Cell>
      <Table.Cell>
        <Badge size="sm" variant="surface" colorPalette={badge.colorPalette}>
          {badge.label}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        {isOpen && invite.expiration ? new Date(invite.expiration).toLocaleDateString() : "\u2014"}
      </Table.Cell>
      <Table.Cell>{roleLabel}</Table.Cell>
      <Table.Cell>
        <TeamIdsDisplay teamIds={invite.teamIds} teams={teams} />
      </Table.Cell>
      <Table.Cell>
        <Box width="full" height="full" display="flex" justifyContent="end">
          <InviteRowActions
            invite={invite}
            canViewLink={canViewLink}
            canResend={canResend}
            onViewInviteLink={onViewInviteLink}
            onResendInvite={onResendInvite}
            onRevokeInvite={onRevokeInvite}
          />
        </Box>
      </Table.Cell>
    </Table.Row>
  );
};

const InviteRowActions = ({
  invite,
  canViewLink,
  canResend,
  onViewInviteLink,
  onResendInvite,
  onRevokeInvite,
}: Pick<InvitesTableProps, "onViewInviteLink" | "onResendInvite" | "onRevokeInvite"> & {
  invite: OrganizationInvite;
  canViewLink: boolean;
  canResend: boolean;
}) => {
  if (!canViewLink && !canResend) return null;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton aria-label="Invite actions" variant="ghost" size="sm">
          <MoreVertical size={16} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content>
        {canViewLink && (
          <Menu.Item
            value="view-link"
            onClick={() => onViewInviteLink(invite.inviteCode, invite.email)}
          >
            <Mail size={16} />
            View invite link
          </Menu.Item>
        )}
        {canResend && (
          <Menu.Item value="resend" onClick={() => onResendInvite(invite.id)}>
            <RefreshCw size={16} />
            Resend invitation
          </Menu.Item>
        )}
        {canResend && (
          <Menu.Item value="revoke" color="red.500" onClick={() => onRevokeInvite(invite.id)}>
            <Trash2 size={16} />
            Revoke
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
};

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
