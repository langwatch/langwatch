import {
  Button,
  Card,
  Field,
  HStack,
  Heading,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { Link } from "../../../components/ui/link";
import { TeamUserRoleField } from "../../../components/settings/TeamUserRoleField";
import { OrganizationUserRoleField } from "../../../components/settings/OrganizationUserRoleField";
import SettingsLayout from "../../../components/SettingsLayout";
import { api } from "../../../utils/api";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { MoreVertical, Trash } from "react-feather";
import { toaster } from "../../../components/ui/toaster";
import { Menu } from "../../../components/ui/menu";

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
      { enabled: !!organization },
    );

  const apiContext = api.useContext();
  const updateTeam = api.team.update.useMutation();

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
        <HStack width="full">
          <Heading size="lg" as="h1">
            {member.user.name}
          </Heading>
        </HStack>

        <Card.Root width="full">
          <Card.Header>
            <Heading size="md">Profile</Heading>
          </Card.Header>
          <Card.Body>
            <VStack align="start" gap={3}>
              <Text>
                <b>Email:</b> {member.user.email}
              </Text>
              <Text color="gray.600" fontSize="sm">
                Organization-level role. Team-specific roles are set per team
                below.
              </Text>
              <HStack gap={3} align="center">
                <Text>
                  <b>Role:</b>
                </Text>
                <Field.Root>
                  <OrganizationUserRoleField
                    organizationId={organization.id}
                    userId={member.userId}
                    defaultRole={member.role}
                  />
                </Field.Root>
              </HStack>
            </VStack>
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
                            member={tm as any}
                            organizationId={organization.id}
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
                                apiContext.team.getTeamsWithMembers
                                  .fetch({ organizationId: organization.id })
                                  .then((teams) => {
                                    const team = (teams as any[]).find(
                                      (t) =>
                                        t.id === tm.teamId ||
                                        t.slug === tm.team.slug,
                                    );
                                    if (!team) return;
                                    const newMembers = (team.members as any[])
                                      .filter((m) => m.userId !== member.userId)
                                      .map((m) => ({
                                        userId: m.userId,
                                        role: m.role,
                                      }));
                                    updateTeam.mutate(
                                      {
                                        teamId: tm.teamId,
                                        name: tm.team.name,
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
                                      },
                                    );
                                  })
                                  .catch(() => {
                                    toaster.create({
                                      title: "Failed to load team",
                                      type: "error",
                                      duration: 2000,
                                    });
                                  });
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

        <Link href="/settings/members">
          <Button variant="outline">Back to Members</Button>
        </Link>
      </VStack>
    </SettingsLayout>
  );
}
