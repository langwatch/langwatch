import {
  Button,
  Card,
  Field,
  HStack,
  Heading,
  Icon,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { ChevronRight, MoreVertical, Trash } from "react-feather";
import { HorizontalFormControl } from "../../../components/HorizontalFormControl";
import { OrganizationUserRoleField } from "../../../components/settings/OrganizationUserRoleField";
import { TeamUserRoleField } from "../../../components/settings/TeamUserRoleField";
import SettingsLayout from "../../../components/SettingsLayout";
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
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organization?.id ?? "" },
      {
        enabled: !!organization?.id,
        retry: false, // Don't retry on error to avoid infinite loops
      },
    );

  const apiContext = api.useContext();
  const updateTeam = api.team.update.useMutation();

  /**
   * Remove user from team
   * Single Responsibility: Handle the removal of a user from a specific team
   */
  const handleRemoveFromTeam = async (
    teamMembership: NonNullable<typeof member>["user"]["teamMemberships"][0],
  ) => {
    if (!member || !organization) {
      toaster.create({
        title: "Missing required data",
        type: "error",
        duration: 2000,
      });
      return;
    }

    try {
      const teams = await apiContext.team.getTeamsWithMembers.fetch({
        organizationId: organization.id,
      });

      const team = teams.find(
        (t) =>
          t.id === teamMembership.teamId || t.slug === teamMembership.team.slug,
      );

      if (!team) {
        toaster.create({
          title: "Team not found",
          type: "error",
          duration: 2000,
        });
        return;
      }

      const newMembers = team.members
        .filter((m) => m.userId !== member.userId)
        .map(({ userId, role }) => ({ userId, role }));

      updateTeam.mutate(
        {
          teamId: teamMembership.teamId,
          name: teamMembership.team.name,
          members: newMembers,
        },
        {
          onSuccess: () => {
            toaster.create({
              title: "Removed from team",
              type: "success",
              duration: 2000,
            });
            void organizationWithMembers.refetch();
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
    } catch (error) {
      toaster.create({
        title: "Failed to load team",
        type: "error",
        duration: 2000,
      });
    }
  };

  const member = useMemo(() => {
    if (!userId || !organizationWithMembers.data) return undefined;
    return organizationWithMembers.data.members.find(
      (m) => m.userId === userId,
    );
  }, [userId, organizationWithMembers.data]);

  if (!organization || !organizationWithMembers.data) {
    return <SettingsLayout />;
  }

  if (!member) {
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
          <Text>{member.user.name}</Text>
        </HStack>

        <HStack width="full" justify="space-between" align="center">
          <Heading size="lg" as="h1">
            Member
          </Heading>
        </HStack>

        <Card.Root width="full">
          <Card.Body paddingY={2}>
            <HorizontalFormControl label="Email">
              <Text>{member.user.email}</Text>
            </HorizontalFormControl>
            <HorizontalFormControl
              label="Organization Role"
              helper="Team-specific roles are set per team below."
            >
              <Field.Root>
                <OrganizationUserRoleField
                  organizationId={organization.id}
                  userId={member.userId}
                  defaultRole={member.role}
                />
              </Field.Root>
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
                {member.user.teamMemberships
                  .filter((tm) => tm.team.organizationId === organization.id)
                  .map((tm) => (
                    <Table.Row key={tm.team.id}>
                      <Table.Cell>
                        <Link href={`/settings/teams/${tm.team.slug}`}>
                          {tm.team.name}
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Field.Root>
                          <TeamUserRoleField
                            member={{
                              ...tm,
                              user: member.user,
                            }}
                            organizationId={organization.id}
                            customRole={(() => {
                              const customRoleAssignment =
                                member.user.customRoleAssignments.find(
                                  (cra) => cra.teamId === tm.teamId,
                                );
                              return customRoleAssignment?.customRole
                                ? {
                                    ...customRoleAssignment.customRole,
                                    permissions: customRoleAssignment.customRole
                                      .permissions as string[],
                                  }
                                : undefined;
                            })()}
                          />
                        </Field.Root>
                      </Table.Cell>
                      <Table.Cell>
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
