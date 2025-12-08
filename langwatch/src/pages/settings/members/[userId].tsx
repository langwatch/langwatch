import {
  Button,
  Card,
  Field,
  Heading,
  HStack,
  Icon,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { ChevronRight, MoreVertical, Trash } from "react-feather";
import { HorizontalFormControl } from "../../../components/HorizontalFormControl";
import SettingsLayout from "../../../components/SettingsLayout";
import { OrganizationUserRoleField } from "../../../components/settings/OrganizationUserRoleField";
import { TeamUserRoleField } from "../../../components/settings/TeamUserRoleField";
import { Link } from "../../../components/ui/link";
import { Menu } from "../../../components/ui/menu";
import { toaster } from "../../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
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

  if (!organization || !member.data) {
    return <SettingsLayout />;
  }

  const memberData = member.data;

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
                    organizationId={organization.id}
                    userId={memberData.userId}
                    defaultRole={memberData.role}
                  />
                </Field.Root>
              ) : (
                <Text>
                  {memberData.role === "ADMIN"
                    ? "Organization Admin"
                    : memberData.role === "MEMBER"
                      ? "Organization Member"
                      : memberData.role}
                </Text>
              )}
            </HorizontalFormControl>
          </Card.Body>
        </Card.Root>

        <Heading size="md">Teams</Heading>
        <Card.Root width="full">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Team</Table.ColumnHeader>
                  <Table.ColumnHeader w={"35%"}>Role</Table.ColumnHeader>
                  <Table.ColumnHeader w={"10%"}>Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {filteredTeamMemberships.map((tm) => (
                  <Table.Row key={tm.team.id}>
                    <Table.Cell>
                      <Link href={`/settings/teams/${tm.team.slug}`}>
                        {tm.team.name}
                      </Link>
                    </Table.Cell>
                    <Table.Cell>
                      {hasPermission("team:manage") ? (
                        <Field.Root>
                          <TeamUserRoleField
                            member={{
                              ...tm,
                              user: memberData.user,
                            }}
                            organizationId={organization.id}
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
                    <Table.Cell>
                      {hasPermission("team:manage") && (
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button variant={"ghost"}>
                              <MoreVertical />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            <Menu.Item
                              value="remove"
                              color="red.600"
                              onClick={() => {
                                void handleRemoveFromTeam(tm);
                              }}
                            >
                              <Trash size={14} style={{ marginRight: "8px" }} />
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
