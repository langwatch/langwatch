import {
  Button,
  Card,
  HStack,
  Heading,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "react-feather";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { TeamWithProjectsAndMembersAndUsers } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { Link } from "../../components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { Menu } from "../../components/ui/menu";
import { TeamRoleGroup } from "~/server/api/permission";
import { MoreVertical } from "react-feather";
import { Archive } from "react-feather";

export default function Teams() {
  const { organization, hasTeamPermission } = useOrganizationTeamProject();

  const teams = api.team.getTeamsWithMembers.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization }
  );

  if (!teams.data) return <SettingsLayout />;

  return <TeamsList teams={teams.data} />;
}

function TeamsList({ teams }: { teams: TeamWithProjectsAndMembersAndUsers[] }) {
  const {
    hasTeamPermission,
    project,
    team: currentTeam,
  } = useOrganizationTeamProject();
  const queryClient = api.useContext();
  const archiveTeam = api.team.archiveById.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Team archived successfully",
        type: "success",
      });
      void queryClient.team.getTeamsWithMembers.invalidate();
    },
  });
  const onArchiveProject = (teamId: string) => {
    if (
      confirm(
        "Are you sure you want to archive this team? This action cannot be undone."
      )
    ) {
      archiveTeam.mutate({ teamId, projectId: project?.id ?? "" });
    }
  };

  console.log("currentTeam", currentTeam);

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full">
          <Heading size="lg" as="h1">
            Teams
          </Heading>
          <Spacer />
          <Link href={`/settings/teams/new`} asChild>
            <Button size="sm" colorPalette="orange">
              <Plus size={20} />
              <Text>Add new team</Text>
            </Button>
          </Link>
        </HStack>
        <Card.Root width="full">
          <Card.Body width="full" paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Members</Table.ColumnHeader>
                  <Table.ColumnHeader>Projects</Table.ColumnHeader>
                  <Table.ColumnHeader w={"10PX"}>Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {teams.map((team) => (
                  <Table.Row key={team.id}>
                    <Table.Cell>
                      <Link
                        href={`/settings/teams/${team.slug}`}
                        _hover={{ textDecoration: "underline" }}
                      >
                        {team.name}
                      </Link>
                    </Table.Cell>
                    <Table.Cell>
                      {team.members.length}{" "}
                      {team.members.length == 1 ? "member" : "members"}
                    </Table.Cell>
                    <Table.Cell>
                      {team.projects.length}{" "}
                      {team.projects.length == 1 ? "project" : "projects"}
                    </Table.Cell>
                    <Table.Cell align="right">
                      {team.id !== team?.id &&
                        hasTeamPermission(
                          TeamRoleGroup.TEAM_ARCHIVE,
                          currentTeam
                        ) && (
                          <Menu.Root>
                            <Menu.Trigger className="js-inner-menu">
                              <MoreVertical size={18} />
                            </Menu.Trigger>
                            <Menu.Content className="js-inner-menu">
                              <Menu.Item
                                value="delete"
                                color="red.500"
                                onClick={() => onArchiveProject(team.id)}
                              >
                                <Archive size={14} />
                                Archive
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
