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
import {
  MISSING_CUSTOM_ROLE_VALUE,
  teamRolesOptions,
  TeamUserRoleField,
} from "../../../components/settings/TeamUserRoleField";
import { Link } from "../../../components/ui/link";
import { Menu } from "../../../components/ui/menu";
import { toaster } from "../../../components/ui/toaster";
import { checkCompoundLimits } from "../../../hooks/useCompoundLicenseCheck";
import { useLicenseEnforcement } from "../../../hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import {
  getAutoCorrectedTeamRoleForOrganizationRole,
  getOrganizationRoleLabel,
  type TeamRoleValue,
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

function resolveTeamRoleValue(membership: TeamMembershipWithRole): string {
  if (membership.role === TeamUserRole.CUSTOM) {
    return membership.assignedRole
      ? `custom:${membership.assignedRole.id}`
      : MISSING_CUSTOM_ROLE_VALUE;
  }
  return membership.role;
}

function getTeamRoleDisplayName(membership: TeamMembershipWithRole): string {
  if (membership.role === "CUSTOM") {
    return membership.assignedRole?.name ?? "Custom";
  }
  const option = teamRolesOptions[membership.role as keyof typeof teamRolesOptions];
  return option?.label ?? membership.role;
}

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
          role: resolveTeamRoleValue(tm),
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

    const currentRole = resolveTeamRoleValue(teamMembership);
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

function hasPendingRoleChanges(params: {
  teamMemberships: TeamMembershipWithRole[];
  pendingTeamRoles: PendingTeamRoleMap;
  pendingOrganizationRole: OrganizationUserRole | null;
  currentOrganizationRole: OrganizationUserRole;
}): boolean {
  const {
    teamMemberships,
    pendingTeamRoles,
    pendingOrganizationRole,
    currentOrganizationRole,
  } = params;

  if (
    pendingOrganizationRole !== null &&
    pendingOrganizationRole !== currentOrganizationRole
  ) {
    return true;
  }

  return teamMemberships.some((teamMembership) => {
    const pending = pendingTeamRoles[teamMembership.teamId];
    if (!pending) return false;

    const currentRole = resolveTeamRoleValue(teamMembership);

    return (
      pending.role !== currentRole ||
      (pending.customRoleId ?? null) !== (teamMembership.assignedRole?.id ?? null)
    );
  });
}

function arePendingTeamRolesEqual(
  left: PendingTeamRoleMap,
  right: PendingTeamRoleMap,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([teamId, leftRole]) => {
    const rightRole = right[teamId];
    if (!rightRole) return false;
    return (
      leftRole.role === rightRole.role &&
      (leftRole.customRoleId ?? null) === (rightRole.customRoleId ?? null)
    );
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
          currentTeamRole: teamRole.role as TeamRoleValue,
        }),
        customRoleId:
          organizationRole === OrganizationUserRole.EXTERNAL
            ? undefined
            : teamRole.customRoleId,
      },
    ]),
  );
}

export default function UserDetailsPage() {
  const router = useRouter();
  const { userId } = router.query as { userId?: string };
  const { organization, hasOrgPermission } =
    useOrganizationTeamProject();

  const canManageOrganization = hasOrgPermission("organization:manage");

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
  const membersEnforcement = useLicenseEnforcement("members");
  const membersLiteEnforcement = useLicenseEnforcement("membersLite");
  const [pendingOrganizationRole, setPendingOrganizationRole] =
    useState<OrganizationUserRole | null>(null);
  const [pendingTeamRoles, setPendingTeamRoles] = useState<PendingTeamRoleMap>(
    {},
  );

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

  const hasMissingCustomRoleAssignments = useMemo(
    () =>
      Object.values(pendingTeamRoles).some(
        (pendingTeamRole) =>
          pendingTeamRole.role === TeamUserRole.CUSTOM ||
          pendingTeamRole.role === MISSING_CUSTOM_ROLE_VALUE,
      ),
    [pendingTeamRoles],
  );

  const hasPendingChanges = useMemo(
    () =>
      member.data
        ? hasPendingRoleChanges({
            teamMemberships: filteredTeamMemberships,
            pendingTeamRoles,
            pendingOrganizationRole,
            currentOrganizationRole: member.data.role,
          })
        : false,
    [member.data, filteredTeamMemberships, pendingTeamRoles, pendingOrganizationRole],
  );

  useEffect(() => {
    if (!member.data) return;
    const nextPendingTeamRoles = buildInitialPendingTeamRoles({
      teamMemberships: member.data.user.teamMemberships,
      organizationId: organization?.id,
    });
    const isSyncedWithServer =
      pendingOrganizationRole === member.data.role &&
      arePendingTeamRolesEqual(pendingTeamRoles, nextPendingTeamRoles);
    if (isSyncedWithServer) return;

    if (
      hasPendingRoleChanges({
        teamMemberships: filteredTeamMemberships,
        pendingTeamRoles,
        pendingOrganizationRole,
        currentOrganizationRole: member.data.role,
      })
    ) {
      return;
    }

    setPendingOrganizationRole(member.data.role);
    setPendingTeamRoles(nextPendingTeamRoles);
  }, [
    member.data,
    organization?.id,
    filteredTeamMemberships,
    pendingTeamRoles,
    pendingOrganizationRole,
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

  const goBack = () => {
    router.back();
  };

  const saveMemberChanges = async () => {
    if (!member.data || !organization || pendingOrganizationRole === null) return;
    const nextOrganizationRole = pendingOrganizationRole;
    const teamRoleUpdates = getTeamRoleUpdates({
      teamMemberships: filteredTeamMemberships,
      pendingTeamRoles,
      userId: member.data.userId,
    });
    const organizationRoleChanged = nextOrganizationRole !== member.data.role;

    try {
      if (!canManageOrganization || (!organizationRoleChanged && teamRoleUpdates.length === 0)) {
        return;
      }

      await updateMemberRole.mutateAsync({
        organizationId: organization.id,
        userId: member.data.userId,
        role: nextOrganizationRole,
        teamRoleUpdates,
      });

      toaster.create({
        title: "Member updated",
        type: "success",
        duration: 2500,
      });
      await apiContext.organization.getMemberById.invalidate();
      await apiContext.organization.getAll.invalidate();
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
    if (hasMissingCustomRoleAssignments) {
      toaster.create({
        title: "Cannot save member",
        description: "Resolve missing custom roles before saving changes.",
        type: "error",
      });
      return;
    }

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
          {canManageOrganization ? (
            <HStack>
              <Button variant="outline" onClick={goBack}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleSave()}
                disabled={
                  !hasPendingChanges ||
                  hasMissingCustomRoleAssignments ||
                  updateMemberRole.isLoading
                }
              >
                {updateMemberRole.isLoading ? (
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
                {filteredTeamMemberships.map((tm) => {
                  const customRoleForTeam = tm.assignedRole
                    ? { ...tm.assignedRole, permissions: tm.assignedRole.permissions as string[] }
                    : undefined;

                  return (
                    <Table.Row key={tm.team.id}>
                      <Table.Cell paddingLeft={6}>
                        <Link href={`/settings/teams/${tm.team.slug}`}>
                          {tm.team.name}
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        {canManageOrganization ? (
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
                              customRole={customRoleForTeam}
                            />
                          </Field.Root>
                        ) : (
                          <Text>
                            {getTeamRoleDisplayName(tm)}
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell paddingRight={6}>
                        {canManageOrganization && (
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
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}
