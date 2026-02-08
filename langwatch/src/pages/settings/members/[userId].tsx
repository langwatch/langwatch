import {
  Button,
  Card,
  Field,
  Heading,
  HStack,
  Icon,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  type CustomRole,
  OrganizationUserRole,
  type Team,
  TeamUserRole,
  type TeamUser,
} from "@prisma/client";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, MoreVertical } from "lucide-react";
import { LuTrash } from "react-icons/lu";
import { HorizontalFormControl } from "../../../components/HorizontalFormControl";
import SettingsLayout from "../../../components/SettingsLayout";
import { OrganizationUserRoleField } from "../../../components/settings/OrganizationUserRoleField";
import { TeamUserRoleField } from "../../../components/settings/TeamUserRoleField";
import { Link } from "../../../components/ui/link";
import { Menu } from "../../../components/ui/menu";
import { toaster } from "../../../components/ui/toaster";
import { checkCompoundLimits } from "../../../hooks/useCompoundLicenseCheck";
import { useLicenseEnforcement } from "../../../hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import {
  getAutoCorrectedTeamRoleForOrganizationRole,
  getOrganizationRoleLabel,
} from "../../../utils/memberRoleConstraints";
import { isHandledByGlobalLicenseHandler } from "../../../utils/trpcError";
import { api } from "../../../utils/api";

type PendingTeamRole = {
  role: string;
  customRoleId?: string;
};

type PendingTeamRoleMap = Record<string, PendingTeamRole>;

type TeamRoleUpdatePayload = {
  teamId: string;
  userId: string;
  role: string;
  customRoleId?: string;
};

type TeamMembershipWithRole = TeamUser & {
  assignedRole?: CustomRole | null;
  team: Team;
};

function buildInitialPendingTeamRoles(params: {
  teamMemberships: TeamMembershipWithRole[];
  organizationId?: string;
}): PendingTeamRoleMap {
  const { teamMemberships, organizationId } = params;
  return Object.fromEntries(
    teamMemberships
      .filter((tm) => tm.team.organizationId === organizationId)
      .map((tm) => [
        tm.teamId,
        {
          role:
            tm.role === TeamUserRole.CUSTOM && tm.assignedRole
              ? `custom:${tm.assignedRole.id}`
              : tm.role,
          customRoleId:
            tm.role === TeamUserRole.CUSTOM ? tm.assignedRole?.id : undefined,
        },
      ]),
  );
}

function getTeamRoleUpdates(params: {
  teamMemberships: TeamMembershipWithRole[];
  pendingTeamRoles: PendingTeamRoleMap;
  userId: string;
}): TeamRoleUpdatePayload[] {
  const { teamMemberships, pendingTeamRoles, userId } = params;

  return teamMemberships.flatMap((teamMembership) => {
    const pending = pendingTeamRoles[teamMembership.teamId];
    if (!pending) return [];

    const currentRole =
      teamMembership.role === TeamUserRole.CUSTOM && teamMembership.assignedRole
        ? `custom:${teamMembership.assignedRole.id}`
        : teamMembership.role;
    const currentCustomRoleId =
      teamMembership.role === TeamUserRole.CUSTOM
        ? teamMembership.assignedRole?.id
        : undefined;

    if (
      pending.role === currentRole &&
      (pending.customRoleId ?? undefined) === currentCustomRoleId
    ) {
      return [];
    }

    return [
      {
        teamId: teamMembership.teamId,
        userId,
        role: pending.role,
        customRoleId: pending.customRoleId,
      },
    ];
  });
}

function getLicenseLimitTypeForRoleChange(params: {
  previousRole: OrganizationUserRole;
  nextRole: OrganizationUserRole;
}): "members" | "membersLite" | null {
  const { previousRole, nextRole } = params;

  if (
    previousRole === OrganizationUserRole.EXTERNAL &&
    nextRole !== OrganizationUserRole.EXTERNAL
  ) {
    return "members";
  }

  if (
    previousRole !== OrganizationUserRole.EXTERNAL &&
    nextRole === OrganizationUserRole.EXTERNAL
  ) {
    return "membersLite";
  }

  return null;
}

function applyOrganizationRoleToPendingTeamRoles(params: {
  organizationRole: OrganizationUserRole;
  currentPendingTeamRoles: PendingTeamRoleMap;
}): PendingTeamRoleMap {
  const { organizationRole, currentPendingTeamRoles } = params;

  return Object.fromEntries(
    Object.entries(currentPendingTeamRoles).map(([teamId, teamRole]) => [
      teamId,
      {
        role: getAutoCorrectedTeamRoleForOrganizationRole({
          organizationRole,
          currentTeamRole: teamRole.role,
        }),
        customRoleId:
          organizationRole === OrganizationUserRole.EXTERNAL
            ? undefined
            : teamRole.customRoleId,
      },
    ]),
  );
}
/**
 * UserDetailsPage
 * Single Responsibility: Display a user's details, allow changing org role, and list team memberships
 */
export default function UserDetailsPage() {
  const router = useRouter();
  const { userId } = router.query as { userId?: string };
  const { organization, hasOrgPermission, hasPermission } =
    useOrganizationTeamProject();

  const canManageOrganization = hasOrgPermission("organization:manage");
  const canManageTeams = hasPermission("team:manage");

  const apiContext = api.useContext();

  const member = api.organization.getMemberById.useQuery(
    {
      organizationId: organization?.id ?? "",
      userId: userId ?? "",
    },
    {
      enabled: !!organization?.id && !!userId,
      retry: false,
    },
  );

  const removeMemberFromTeam = api.team.removeMember.useMutation();
  const updateMemberRole = api.organization.updateMemberRole.useMutation();
  const updateTeamMemberRole = api.organization.updateTeamMemberRole.useMutation();
  const membersEnforcement = useLicenseEnforcement("members");
  const membersLiteEnforcement = useLicenseEnforcement("membersLite");
  const [pendingOrganizationRole, setPendingOrganizationRole] =
    useState<OrganizationUserRole | null>(null);
  const [pendingTeamRoles, setPendingTeamRoles] = useState<PendingTeamRoleMap>(
    {},
  );

  /**
   * Remove user from team
   * Single Responsibility: Handle the removal of a user from a specific team
   */
  const handleRemoveFromTeam = async (
    teamMembership: NonNullable<
      typeof member.data
    >["user"]["teamMemberships"][0],
  ) => {
    if (!member.data || !organization) {
      toaster.create({
        title: "Missing required data",
        type: "error",
        duration: 2000,
      });
      return;
    }

    removeMemberFromTeam.mutate(
      {
        teamId: teamMembership.teamId,
        userId: member.data.userId,
      },
      {
        onSuccess: () => {
          toaster.create({
            title: "Removed from team",
            type: "success",
            duration: 2000,
          });
          // Invalidate organization queries to refresh member data and team memberships
          void apiContext.organization.getMemberById.invalidate();
          void apiContext.organization.getAll.invalidate();
        },
        onError: () => {
          toaster.create({
            title: "Failed to remove from team",
            type: "error",
            duration: 2000,
          });
        },
      },
    );
  };

  const filteredTeamMemberships = useMemo(
    () =>
      member.data?.user.teamMemberships.filter(
        (tm) => tm.team.organizationId === organization?.id,
      ) ?? [],
    [member.data?.user.teamMemberships, organization?.id],
  );

  useEffect(() => {
    if (!member.data) return;
    setPendingOrganizationRole(member.data.role);
    setPendingTeamRoles(
      buildInitialPendingTeamRoles({
        teamMemberships: member.data.user.teamMemberships,
        organizationId: organization?.id,
      }),
    );
  }, [member.data, organization?.id]);

  const hasPendingChanges = useMemo(() => {
    if (!member.data || pendingOrganizationRole === null) return false;
    const currentOrganizationRole = pendingOrganizationRole;
    if (currentOrganizationRole !== member.data.role) return true;

    return filteredTeamMemberships.some((tm) => {
      const currentRole =
        tm.role === TeamUserRole.CUSTOM && tm.assignedRole
          ? `custom:${tm.assignedRole.id}`
          : tm.role;
      const pending = pendingTeamRoles[tm.teamId];
      if (!pending) return false;
      return (
        pending.role !== currentRole ||
        (pending.customRoleId ?? null) !== (tm.assignedRole?.id ?? null)
      );
    });
  }, [
    member.data,
    pendingOrganizationRole,
    filteredTeamMemberships,
    pendingTeamRoles,
  ]);

  const handleOrganizationRoleChange = (nextRole: OrganizationUserRole) => {
    setPendingOrganizationRole(nextRole);
    setPendingTeamRoles((current) =>
      applyOrganizationRoleToPendingTeamRoles({
        organizationRole: nextRole,
        currentPendingTeamRoles: current,
      }),
    );
  };

  const goBackOrMembersList = () => {
    void router.push("/settings/members");
  };

  const saveMemberChanges = async () => {
    if (!member.data || !organization || pendingOrganizationRole === null) return;
    const nextOrganizationRole = pendingOrganizationRole;

    try {
      if (nextOrganizationRole !== member.data.role) {
        await updateMemberRole.mutateAsync({
          organizationId: organization.id,
          userId: member.data.userId,
          role: nextOrganizationRole,
        });
      }

      const teamRoleUpdates = getTeamRoleUpdates({
        teamMemberships: filteredTeamMemberships,
        pendingTeamRoles,
        userId: member.data.userId,
      });

      for (const teamRoleUpdate of teamRoleUpdates) {
        await updateTeamMemberRole.mutateAsync({
          teamId: teamRoleUpdate.teamId,
          userId: teamRoleUpdate.userId,
          role: teamRoleUpdate.role,
          customRoleId: teamRoleUpdate.customRoleId,
        });
      }

      toaster.create({
        title: "Member updated",
        type: "success",
        duration: 2500,
      });
      await apiContext.organization.getMemberById.invalidate();
      await apiContext.organization.getAll.invalidate();
      goBackOrMembersList();
    } catch (error) {
      if (isHandledByGlobalLicenseHandler(error)) return;
      toaster.create({
        title: "Failed to update member",
        description:
          error instanceof Error ? error.message : "Please try again",
        type: "error",
      });
    }
  };

  const handleSave = () => {
    if (!member.data || pendingOrganizationRole === null) return;

    const limitType = getLicenseLimitTypeForRoleChange({
      previousRole: member.data.role,
      nextRole: pendingOrganizationRole,
    });

    const enforcementByLimitType = {
      members: membersEnforcement,
      membersLite: membersLiteEnforcement,
    } as const;

    const enforcements = limitType ? [enforcementByLimitType[limitType]] : [];

    checkCompoundLimits(enforcements, () => {
      void saveMemberChanges();
    });
  };

  if (!organization || !member.data) {
    return <SettingsLayout />;
  }

  const memberData = member.data;
  const currentOrganizationRole: OrganizationUserRole =
    pendingOrganizationRole ?? memberData.role;

  if (!memberData) {
    return (
      <SettingsLayout>
        <VStack paddingX={4} paddingY={6} gap={6} align="start">
          <Heading size="lg" as="h1">
            User not found
          </Heading>
          <Link href="/settings/members">
            <Button variant="outline">Back to Members</Button>
          </Link>
        </VStack>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="980px"
        align="start"
      >
        <HStack gap="8px">
          <Link href="/settings/members">Members</Link>
          <Icon>
            <ChevronRight width={12} />
          </Icon>
          <Text>{memberData.user.name}</Text>
        </HStack>

        <HStack width="full" justify="space-between" align="center">
          <Heading size="lg" as="h1">
            Member
          </Heading>
          {(canManageOrganization || canManageTeams) ? (
            <HStack>
              <Button variant="outline" onClick={goBackOrMembersList}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleSave()}
                disabled={
                  !hasPendingChanges ||
                  updateMemberRole.isLoading ||
                  updateTeamMemberRole.isLoading
                }
              >
                {updateMemberRole.isLoading || updateTeamMemberRole.isLoading ? (
                  <HStack>
                    <Spinner size="sm" />
                    <Text>Saving...</Text>
                  </HStack>
                ) : (
                  "Save"
                )}
              </Button>
            </HStack>
          ) : (
            <Button variant="outline" onClick={goBackOrMembersList}>
              Back
            </Button>
          )}
        </HStack>

        <Card.Root width="full">
          <Card.Body paddingY={2}>
            <HorizontalFormControl label="Email">
              <Text>{memberData.user.email}</Text>
            </HorizontalFormControl>
            <HorizontalFormControl
              label="Organization Role"
              helper="Team-specific roles are set per team below."
            >
              {canManageOrganization ? (
                <Field.Root>
                  <OrganizationUserRoleField
                    value={currentOrganizationRole}
                    onChange={handleOrganizationRoleChange}
                  />
                </Field.Root>
              ) : (
                <Text>{getOrganizationRoleLabel(memberData.role)}</Text>
              )}
            </HorizontalFormControl>
          </Card.Body>
        </Card.Root>

        <Heading size="md">Teams</Heading>
        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="50%" paddingLeft={6}>Team</Table.ColumnHeader>
                  <Table.ColumnHeader>Role</Table.ColumnHeader>
                  <Table.ColumnHeader width="60px" paddingRight={6}></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {filteredTeamMemberships.map((tm) => (
                  <Table.Row key={tm.team.id}>
                    <Table.Cell paddingLeft={6}>
                      <Link href={`/settings/teams/${tm.team.slug}`}>
                        {tm.team.name}
                      </Link>
                    </Table.Cell>
                    <Table.Cell>
                      {canManageTeams ? (
                        <Field.Root>
                          <TeamUserRoleField
                            member={{
                              ...tm,
                              user: memberData.user,
                            }}
                            organizationId={organization.id}
                            organizationRole={currentOrganizationRole}
                            value={pendingTeamRoles[tm.teamId]?.role}
                            onChange={(nextRole) => {
                              setPendingTeamRoles((current) => ({
                                ...current,
                                [tm.teamId]: {
                                  role: nextRole.value,
                                  customRoleId: nextRole.customRoleId,
                                },
                              }));
                            }}
                            customRole={(() => {
                              // Check if this team membership has an assigned custom role
                              const assignedRole = tm.assignedRole;
                              return assignedRole
                                ? {
                                    ...assignedRole,
                                    permissions:
                                      assignedRole.permissions as string[],
                                  }
                                : undefined;
                            })()}
                          />
                        </Field.Root>
                      ) : (
                        <Text>
                          {tm.role === "CUSTOM" && tm.assignedRole
                            ? tm.assignedRole.name
                            : tm.role === "CUSTOM"
                              ? "Custom"
                              : tm.role === "ADMIN"
                                ? "Admin"
                                : tm.role === "MEMBER"
                                  ? "Member"
                                  : tm.role === "VIEWER"
                                    ? "Viewer"
                                    : tm.role}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell paddingRight={6}>
                      {canManageTeams && (
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical size={16} />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            <Menu.Item
                              value="remove"
                              color="red.500"
                              onClick={() => {
                                void handleRemoveFromTeam(tm);
                              }}
                            >
                              <LuTrash size={16} />
                              Remove from team
                            </Menu.Item>
                          </Menu.Content>
                        </Menu.Root>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}
