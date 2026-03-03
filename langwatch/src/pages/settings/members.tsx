import {
  Badge,
  Box,
  Card,
  Flex,
  Heading,
  HStack,
  Spacer,
  Table,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { captureException } from "~/utils/posthogErrorCapture";
import { AddMembersForm } from "../../components/AddMembersForm";
import { CopyInput } from "../../components/CopyInput";
import { orgRoleOptions } from "../../components/settings/OrganizationUserRoleField";
import { getOrgRoleOptionsForUser } from "../../components/members/getOrgRoleOptionsForUser";
import { InvitesTable } from "../../components/members/InvitesTable";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useInviteActions } from "../../hooks/useInviteActions";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import type {
  OrganizationWithMembersAndTheirTeams,
  TeamWithProjects,
} from "../../server/api/routers/organization";
import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { api } from "../../utils/api";

// Create a Map for fast O(1) lookups instead of O(n) .find() in render
const roleLabelMap = new Map(
  orgRoleOptions.map((option) => [option.value, option.label]),
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
  const router = useRouter();
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
  const deleteMemberMutation = api.organization.deleteMember.useMutation();

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

  const {
    onSubmit,
    approveInvite,
    rejectInvite,
    deleteInvite,
    isSubmitting,
  } = useInviteActions({
    organizationId: organization.id,
    isAdmin: hasOrganizationManagePermission,
    hasEmailProvider: hasEmailProvider ?? false,
    onInviteCreated: setSelectedInvites,
    onClose: onAddMembersClose,
    refetchInvites: () => void pendingInvites.refetch(),
    pricingModel: (organization as { pricingModel?: string }).pricingModel,
    activePlanFree: activePlan.free,
    activePlanType: activePlan.type,
    activePlanSource: activePlan.planSource,
  });

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
          void queryClient.organization.getOrganizationWithMembersAndTheirTeams
            .invalidate()
            .catch((error) => {
              captureException(error, {
                tags: {
                  userId,
                  organizationId: organization.id,
                },
              });
            });
          void queryClient.licenseEnforcement.checkLimit.invalidate();
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

  const sortedMembers = useMemo(
    () =>
      [...organization.members].sort((a, b) =>
        b.user.id.localeCompare(a.user.id),
      ),
    [organization.members],
  );

  const canDeleteMember = (memberId: string) =>
    hasOrganizationManagePermission &&
    organization.members.length > 1 &&
    memberId !== user?.id;

  const filteredOrgRoleOptions = useMemo(
    () => getOrgRoleOptionsForUser({ isAdmin: hasOrganizationManagePermission }),
    [hasOrganizationManagePermission],
  );

  const sentInvites = useMemo(
    () =>
      (pendingInvites.data ?? []).filter(
        (invite) => invite.status === "PENDING",
      ),
    [pendingInvites.data],
  );

  const waitingApprovalInvites = useMemo(
    () =>
      (pendingInvites.data ?? []).filter(
        (invite) => invite.status === "WAITING_APPROVAL",
      ),
    [pendingInvites.data],
  );

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>Organization Members</Heading>
          <Spacer />
          <PageLayout.HeaderButton onClick={onAddMembersOpen}>
            <Plus size={20} />
            Add members
          </PageLayout.HeaderButton>
        </HStack>
        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="56px" />
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Email</Table.ColumnHeader>
                  <Table.ColumnHeader>Role</Table.ColumnHeader>
                  <Table.ColumnHeader>Teams</Table.ColumnHeader>
                  <Table.ColumnHeader width="60px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sortedMembers.map((member) => {
                  const roleLabel = roleLabelMap.get(member.role) ?? member.role;

                  return (
                    <Table.Row key={member.userId}>
                      <Table.Cell>
                        <RandomColorAvatar
                          size="2xs"
                          name={member.user.name ?? ""}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Link href={`/settings/members/${member.userId}`}>
                          {member.user.name}
                        </Link>
                      </Table.Cell>
                      <Table.Cell>{member.user.email}</Table.Cell>
                      <Table.Cell>{roleLabel}</Table.Cell>
                      <Table.Cell>
                        <TeamMembershipsDisplay
                          teamMemberships={member.user.teamMemberships}
                          organizationId={organization.id}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Box
                          width="full"
                          height="full"
                          display="flex"
                          justifyContent="end"
                        >
                          <Menu.Root>
                            <Menu.Trigger>
                              <MoreVertical size={16} />
                            </Menu.Trigger>
                            <Menu.Content>
                              <Menu.Item
                                value="edit"
                                onClick={() => {
                                  void router.push(`/settings/members/${member.userId}`);
                                }}
                              >
                                <Pencil size={16} />
                                Edit
                              </Menu.Item>
                              {canDeleteMember(member.userId) && (
                                <Menu.Item
                                  value="delete"
                                  color="red.500"
                                  onClick={() => deleteMember(member.userId)}
                                >
                                  <Trash2 size={16} />
                                  Delete
                                </Menu.Item>
                              )}
                            </Menu.Content>
                          </Menu.Root>
                        </Box>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>

        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={sentInvites}
          isAdmin={hasOrganizationManagePermission}
          currentUserId={user?.id ?? ""}
          teams={teams}
          onApprove={approveInvite}
          onReject={rejectInvite}
          onViewInviteLink={viewInviteLink}
          onDeleteInvite={deleteInvite}
        />
      </VStack>

      <Dialog.Root
        open={isInviteLinkOpen}
        onOpenChange={({ open }) => (open ? undefined : onInviteModalClose())}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>
              <Heading>Invite Link</Heading>
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
                    gap={6}
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
        <Dialog.Content width="100%" maxWidth="1024px">
          <Dialog.Header>
            <Dialog.Title>
              <Heading>Add members</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <AddMembersForm
              teamOptions={teamOptions}
              orgRoleOptions={filteredOrgRoleOptions}
              organizationId={organization.id}
              onSubmit={onSubmit}
              isLoading={isSubmitting}
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
            <Badge size="sm" variant="surface">
              {m.name}
            </Badge>
          </Link>
        ))}
    </Flex>
  );
};
