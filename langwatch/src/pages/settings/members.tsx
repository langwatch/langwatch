import {
  Badge,
  Button,
  Card,
  Flex,
  HStack,
  Heading,
  LinkBox,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { Link } from "../../components/ui/link";
import { OrganizationUserRole } from "@prisma/client";
import { Lock, Mail, MoreVertical, Plus, Trash } from "react-feather";
import { CopyInput } from "../../components/CopyInput";
import { AddMembersForm } from "../../components/AddMembersForm";
import type { MembersForm } from "../../components/AddMembersForm";

import { useState, useMemo, useEffect } from "react";
import { type SubmitHandler } from "react-hook-form";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import type {
  OrganizationWithMembersAndTheirTeams,
  TeamWithProjects,
} from "../../server/api/routers/organization";
import { type PlanInfo } from "../../server/subscriptionHandler";
import { api } from "../../utils/api";
import * as Sentry from "@sentry/nextjs";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { withPermissionGuard } from "../../components/WithPermissionGuard";

const selectOptions = [
  {
    label: "Admin",
    value: OrganizationUserRole.ADMIN,
    description: "Can manage organization and add or remove members",
  },
  {
    label: "Member",
    value: OrganizationUserRole.MEMBER,
    description: "Can manage their own projects and view other projects",
  },
  {
    label: "External / Viewer",
    value: OrganizationUserRole.EXTERNAL,
    description: "Can only view projects they are invited to, cannot see costs",
  },
];

// Create a Map for fast O(1) lookups instead of O(n) .find() in render
const roleLabelMap = new Map(
  selectOptions.map((option) => [option.value, option.label]),
);

function Members() {
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      { enabled: !!organization },
    );
  const activePlan = api.plan.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization,
    },
  );

  if (!organization || !organizationWithMembers.data || !activePlan.data)
    return <SettingsLayout />;

  return (
    <MembersList
      teams={organization.teams}
      organization={organizationWithMembers.data}
      activePlan={activePlan.data}
    />
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(Members);

function MembersList({
  organization,
  teams,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  teams: TeamWithProjects[];
  activePlan: PlanInfo;
}) {
  const { data: session } = useRequiredSession();
  const { hasPermission } = useOrganizationTeamProject();
  const hasOrganizationManagePermission = hasPermission("organization:manage");
  const user = session?.user;
  const teamOptions = teams.map((team) => ({
    label: team.name,
    value: team.id,
  }));
  const queryClient = api.useContext();

  const {
    open: isAddMembersOpen,
    onOpen: onAddMembersOpen,
    onClose: onAddMembersClose,
  } = useDisclosure();

  const {
    open: isInviteLinkOpen,
    onOpen: onInviteLinkOpen,
    onClose: onInviteLinkClose,
  } = useDisclosure();

  const pendingInvites =
    api.organization.getOrganizationPendingInvites.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      { enabled: !!organization },
    );
  const createInvitesMutation = api.organization.createInvites.useMutation();
  const deleteMemberMutation = api.organization.deleteMember.useMutation();
  const deleteInviteMutation = api.organization.deleteInvite.useMutation();

  const [selectedInvites, setSelectedInvites] = useState<
    { inviteCode: string; email: string }[]
  >([]);

  // Watch for changes in selectedInvites and open popup when it changes
  useEffect(() => {
    if (selectedInvites.length > 0) {
      onInviteLinkOpen();
    }
  }, [selectedInvites, onInviteLinkOpen]);

  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY;

  const onSubmit: SubmitHandler<MembersForm> = (data) => {
    createInvitesMutation.mutate(
      {
        organizationId: organization.id,
        invites: data.invites.map((invite) => ({
          email: invite.email.toLowerCase(),
          role: OrganizationUserRole.MEMBER,
          teamIds: invite.teamOptions
            .map((teamOption) => teamOption.value)
            .join(","),
        })),
      },
      {
        onSuccess: (data) => {
          const newInvites = data.reduce(
            (acc, invite) => {
              if (invite?.invite && invite.noEmailProvider) {
                acc.push({
                  inviteCode: invite.invite.inviteCode,
                  email: invite.invite.email,
                });
              }
              return acc;
            },
            [] as { inviteCode: string; email: string }[],
          );

          setSelectedInvites(newInvites);

          const description = hasEmailProvider
            ? "All invites have been sent."
            : "All invites have been created. View invite link under actions menu.";

          toaster.create({
            title: `${
              newInvites.length > 1 ? "Invites" : "Invite"
            } created successfully`,
            description: description,
            type: "success",
            duration: 2000,
            meta: {
              closable: true,
            },
          });
          onAddMembersClose();
          void pendingInvites.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  const deleteMember = (userId: string) => {
    deleteMemberMutation.mutate(
      {
        organizationId: organization.id,
        userId,
      },
      {
        onSuccess: () => {
          toaster.create({
            title: "Member removed successfully",
            description: "The member has been removed from the organization.",
            type: "success",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
          // how to refect this organizationWithMembers
          void queryClient.organization.getOrganizationWithMembersAndTheirTeams
            .invalidate()
            .catch((error) => {
              Sentry.captureException(error, {
                tags: {
                  userId,
                  organizationId: organization.id,
                },
              });
            });
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  const viewInviteLink = (inviteCode: string, email: string) => {
    setSelectedInvites([{ inviteCode, email }]);
    onInviteLinkOpen();
  };

  const onInviteModalClose = () => {
    setSelectedInvites([]);
    onInviteLinkClose();
  };

  const deleteInvite = (inviteId: string) => {
    deleteInviteMutation.mutate(
      { inviteId, organizationId: organization.id },
      {
        onSuccess: () => {
          toaster.create({
            title: "Invite deleted successfully",
            description: "The invite has been deleted.",
            type: "success",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
          void pendingInvites.refetch();
        },
      },
    );
  };

  const sortedMembers = useMemo(
    () =>
      [...organization.members].sort((a, b) =>
        b.user.id.localeCompare(a.user.id),
      ),
    [organization.members],
  );

  const currentUserIsAdmin = useMemo(
    () =>
      organization.members.some(
        (member) =>
          member.userId === user?.id &&
          member.role === OrganizationUserRole.ADMIN,
      ),
    [organization.members, user?.id],
  );

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="1200px"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Organization Members
          </Heading>
          <Spacer />
          {!activePlan.overrideAddingLimitations &&
          organization.members.length >= activePlan.maxMembers ? (
            <Tooltip
              content="Upgrade your plan to add more members"
              positioning={{ placement: "top" }}
            >
              <Button size="sm" colorPalette="orange" disabled={true}>
                <HStack gap={2}>
                  <Lock size={20} />
                  <Text>Add members</Text>
                </HStack>
              </Button>
            </Tooltip>
          ) : (
            <Tooltip
              content={
                !currentUserIsAdmin
                  ? "You need admin privileges to add members"
                  : undefined
              }
              positioning={{ placement: "top" }}
            >
              <Button
                size="sm"
                colorPalette="orange"
                onClick={() => onAddMembersOpen()}
                disabled={!currentUserIsAdmin}
              >
                <HStack gap={2}>
                  <Plus size={20} />
                  <Text>Add members</Text>
                </HStack>
              </Button>
            </Tooltip>
          )}
        </HStack>
        <Card.Root width="full">
          <Card.Body width="full" paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Email</Table.ColumnHeader>
                  <Table.ColumnHeader>Teams</Table.ColumnHeader>
                  <Table.ColumnHeader>Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sortedMembers.map((member) => {
                  const roleLabel =
                    roleLabelMap.get(member.role) ?? member.role;
                  const isDeleteDisabled = member.user.id === user?.id;

                  return (
                    <LinkBox as={Table.Row} key={member.userId}>
                      <Table.Cell>
                        <Link href={`/settings/members/${member.userId}`}>
                          {member.user.name}{" "}
                          <Text
                            as="span"
                            whiteSpace="nowrap"
                          >{`(Organization ${roleLabel})`}</Text>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>{member.user.email}</Table.Cell>
                      <Table.Cell>
                        <TeamMembershipsDisplay
                          teamMemberships={member.user.teamMemberships}
                          organizationId={organization.id}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <HStack gap={2}>
                          <Link href={`/settings/members/${member.userId}`}>
                            <Button size="sm" variant="outline">
                              View
                            </Button>
                          </Link>
                          <Menu.Root>
                            <Menu.Trigger asChild>
                              <Button variant={"ghost"}>
                                <MoreVertical />
                              </Button>
                            </Menu.Trigger>
                            <Menu.Content>
                              <Tooltip
                                content={
                                  !hasOrganizationManagePermission
                                    ? "You need organization:manage permission to remove members"
                                    : organization.members.length === 1
                                    ? "Cannot remove the last member"
                                    : undefined
                                }
                                disabled={
                                  hasOrganizationManagePermission &&
                                  organization.members.length > 1
                                }
                                positioning={{ placement: "right" }}
                                showArrow
                              >
                                <Menu.Item
                                  value="remove"
                                  color="red.600"
                                  disabled={
                                    !hasOrganizationManagePermission ||
                                    organization.members.length === 1
                                  }
                                  onClick={() => {
                                    if (hasOrganizationManagePermission) {
                                      deleteMember(member.userId);
                                    }
                                  }}
                                >
                                  <Trash
                                    size={14}
                                    style={{ marginRight: "8px" }}
                                  />
                                  Remove Member
                                </Menu.Item>
                              </Tooltip>
                            </Menu.Content>
                          </Menu.Root>
                        </HStack>
                      </Table.Cell>
                    </LinkBox>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>

        {pendingInvites.data && pendingInvites.data.length > 0 && (
          <VStack align="start" gap={1} width="full">
            <Heading size="md" as="h2" paddingY={4}>
              Pending Invites
            </Heading>

            <Card.Root width="full">
              <Card.Body width="full" paddingY={0} paddingX={0}>
                <Table.Root>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Email</Table.ColumnHeader>
                      <Table.ColumnHeader>Role</Table.ColumnHeader>
                      <Table.ColumnHeader>Teams</Table.ColumnHeader>
                      <Table.ColumnHeader>Actions</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {pendingInvites.data?.map((invite) => (
                      <Table.Row key={invite.id}>
                        <Table.Cell>{invite.email}</Table.Cell>
                        <Table.Cell>
                          {selectOptions.find(
                            (option) => option.value === invite.role,
                          )?.label ?? invite.role}
                        </Table.Cell>
                        <Table.Cell>
                          <TeamIdsDisplay
                            teamIds={invite.teamIds}
                            teams={teams}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <Menu.Root>
                            <Menu.Trigger asChild>
                              <Button variant={"ghost"}>
                                {deleteInviteMutation.isLoading &&
                                invite.id ===
                                  deleteInviteMutation.variables?.inviteId ? (
                                  <Spinner size="sm" />
                                ) : (
                                  <MoreVertical />
                                )}
                              </Button>
                            </Menu.Trigger>
                            <Menu.Content>
                              <Tooltip
                                content={
                                  !hasOrganizationManagePermission
                                    ? "You need organization:manage permission to delete invites"
                                    : undefined
                                }
                                disabled={hasOrganizationManagePermission}
                                positioning={{ placement: "right" }}
                                showArrow
                              >
                                <Menu.Item
                                  value="delete"
                                  color="red.600"
                                  onClick={() => {
                                    if (hasOrganizationManagePermission) {
                                      deleteInvite(invite.id);
                                    }
                                  }}
                                  disabled={!hasOrganizationManagePermission}
                                >
                                  <Trash
                                    size={14}
                                    style={{ marginRight: "8px" }}
                                  />
                                  Delete
                                </Menu.Item>
                              </Tooltip>
                              <Menu.Item
                                value="view"
                                onClick={() =>
                                  viewInviteLink(
                                    invite.inviteCode,
                                    invite.email,
                                  )
                                }
                              >
                                <Mail
                                  size={14}
                                  style={{ marginRight: "8px" }}
                                />
                                View Invite Link
                              </Menu.Item>
                            </Menu.Content>
                          </Menu.Root>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Card.Body>
            </Card.Root>
          </VStack>
        )}
      </VStack>

      <Dialog.Root
        open={isInviteLinkOpen}
        onOpenChange={({ open }) => (open ? undefined : onInviteModalClose())}
      >
        <Dialog.Backdrop />
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              <HStack>
                <Mail />
                <Text>Invite Link</Text>
              </HStack>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack align="start" gap={4}>
              <Text>
                Send the link below to the users you want to invite to join the
                organization.
              </Text>

              <VStack align="start" gap={4} width="full">
                {selectedInvites.map((invite) => (
                  <VStack
                    key={invite.inviteCode}
                    align="start"
                    gap={2}
                    width="full"
                  >
                    <Text fontWeight="600">{invite.email}</Text>
                    <CopyInput
                      value={`${window.location.origin}/invite/accept?inviteCode=${invite.inviteCode}`}
                      label="Invite Link"
                      marginTop={0}
                    />
                  </VStack>
                ))}
              </VStack>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root
        open={isAddMembersOpen}
        onOpenChange={({ open }) =>
          open ? onAddMembersOpen() : onAddMembersClose()
        }
      >
        <Dialog.Backdrop />
        <Dialog.Content width="100%" maxWidth="1024px">
          <Dialog.Header>
            <Dialog.Title>Add members</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <AddMembersForm
              teamOptions={teamOptions}
              onSubmit={onSubmit}
              isLoading={createInvitesMutation.isLoading}
              hasEmailProvider={hasEmailProvider ?? false}
              onClose={onAddMembersClose}
            />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </SettingsLayout>
  );
}

interface TeamMembershipsDisplayProps {
  teamMemberships: Array<{
    team: { id: string; name: string; slug: string; organizationId: string };
  }>;
  organizationId: string;
}

/**
 * Reusable component to display team memberships as clickable badges
 * Single Responsibility: Renders team memberships as a list of clickable badges
 */
const TeamMembershipsDisplay = ({
  teamMemberships,
  organizationId,
}: TeamMembershipsDisplayProps) => {
  return (
    <Flex gap={2} flexWrap="wrap">
      {teamMemberships
        .flatMap((m) => m.team)
        .filter((m) => m.organizationId === organizationId)
        .map((m) => (
          <Link href={`/settings/teams/${m.slug}`} key={m.id}>
            <Badge size="xs" variant="surface">
              {m.name}
            </Badge>
          </Link>
        ))}
    </Flex>
  );
};

interface TeamIdsDisplayProps {
  teamIds: string;
  teams: Array<{ id: string; name: string; slug: string }>;
}

/**
 * Reusable component to display team IDs as clickable badges
 * Single Responsibility: Renders team IDs as a list of clickable badges
 */
const TeamIdsDisplay = ({ teamIds, teams }: TeamIdsDisplayProps) => {
  return (
    <Flex gap={2} flexWrap="wrap">
      {teamIds.split(",").map((teamId) => {
        const team = teams.find((team) => team.id === teamId);

        if (!team) return null;

        return (
          <Link href={`/settings/teams/${team.slug}`} key={teamId}>
            <Badge size="xs" variant="surface">
              {team.name}
            </Badge>
          </Link>
        );
      })}
    </Flex>
  );
};
