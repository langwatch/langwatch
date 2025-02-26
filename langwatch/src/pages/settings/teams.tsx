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

export default function Teams() {
  const { organization } = useOrganizationTeamProject();

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
