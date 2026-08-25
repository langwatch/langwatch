import { Badge, HStack, IconButton, Text } from "@chakra-ui/react";
import { Mail, MoreVertical, RefreshCw, Trash2 } from "lucide-react";
import {
  IdentityChip,
  IdentityRow,
  IdentityRowList,
} from "~/components/access/IdentityRow";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import type { RouterOutputs } from "~/utils/api";
import { orgRoleOptions } from "../settings/OrganizationUserRoleField";

type OrganizationInvite =
  RouterOutputs["organization"]["getOrganizationPendingInvites"][number];

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
const STATUS_CHIPS: Record<
  string,
  { label: string; tone?: "good" | "warning" | "bad" }
> = {
  PENDING: { label: "Invited" },
  EXPIRED: { label: "Expired", tone: "warning" },
  REVOKED: { label: "Revoked" },
  ACCEPTED: { label: "Accepted", tone: "good" },
  PAYMENT_PENDING: { label: "Awaiting payment", tone: "warning" },
};

/**
 * People who have been invited, on the same identity row as the people who
 * are already here.
 *
 * They used to be a table of their own at the bottom of the members page,
 * with its own columns and its own idea of what a person looks like. Somebody
 * mid-flight is still a person, and reading them as a different kind of
 * object is what made "did I invite them or are they in?" a question worth
 * asking.
 *
 * The invitation's provenance chip is `Invited`, which is exactly the chip
 * they will carry once they accept — the row does not change shape when they
 * cross over.
 */
export function InvitesTable({
  invites,
  isAdmin,
  teams,
  onViewInviteLink,
  onResendInvite,
  onRevokeInvite,
}: InvitesTableProps) {
  return (
    <IdentityRowList
      data-testid="invites-list"
      empty="Nobody has an outstanding invitation."
    >
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
    </IdentityRowList>
  );
}

interface InviteRowProps extends Omit<InvitesTableProps, "invites"> {
  invite: OrganizationInvite;
}

/**
 * Exported because an invitation is one cut of the Directory's single list of
 * people rather than a table of its own — the row travels, the table around it
 * does not.
 */
export const InviteRow = ({
  invite,
  isAdmin,
  teams,
  onViewInviteLink,
  onResendInvite,
  onRevokeInvite,
}: InviteRowProps) => {
  const displayStatus = invite.displayStatus;
  const chip = STATUS_CHIPS[displayStatus] ?? STATUS_CHIPS.PENDING!;
  const roleLabel =
    orgRoleOptions.find((option) => option.value === invite.role)?.label ??
    invite.role;
  const isOpen = displayStatus === "PENDING" || displayStatus === "EXPIRED";
  const canResend = isAdmin && isOpen;
  const canViewLink = displayStatus === "PENDING";

  return (
    <IdentityRow
      id={invite.id}
      // An invitation names an address and nothing else: nobody has told us a
      // name yet, and inventing one from the local part would be a guess the
      // row presents as fact.
      name={invite.email}
      address={null}
      data-testid="invite-row"
      chips={
        <>
          <IdentityChip
            label={chip.label}
            tone={chip.tone}
            data-testid="invite-status"
          />
          {isOpen && invite.expiration ? (
            <Text fontSize="xs" color="fg.muted">
              Lapses {new Date(invite.expiration).toLocaleDateString()}
            </Text>
          ) : null}
        </>
      }
      trailing={
        <HStack gap={3}>
          <TeamIdsDisplay teamIds={invite.teamIds} teams={teams} />
          <Text
            fontSize="sm"
            color="fg.muted"
            minWidth="90px"
            textAlign="right"
          >
            {roleLabel}
          </Text>
          <InviteRowActions
            invite={invite}
            canViewLink={canViewLink}
            canResend={canResend}
            onViewInviteLink={onViewInviteLink}
            onResendInvite={onResendInvite}
            onRevokeInvite={onRevokeInvite}
          />
        </HStack>
      }
    />
  );
};

const InviteRowActions = ({
  invite,
  canViewLink,
  canResend,
  onViewInviteLink,
  onResendInvite,
  onRevokeInvite,
}: Pick<
  InvitesTableProps,
  "onViewInviteLink" | "onResendInvite" | "onRevokeInvite"
> & {
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
          <Menu.Item
            value="revoke"
            color="red.500"
            onClick={() => onRevokeInvite(invite.id)}
          >
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
