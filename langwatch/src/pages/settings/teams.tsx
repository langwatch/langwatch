import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  LinkBox,
  LinkOverlay,
  Spacer,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { Plus } from "react-feather";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type {
  TeamWithMembersAndProjects
} from "../../server/api/routers/organization";
import { api } from "../../utils/api";

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

function TeamsList({ teams }: { teams: TeamWithMembersAndProjects[] }) {
  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full">
          <Heading size="lg" as="h1">
            Teams
          </Heading>
          <Spacer />
          <NextLink href={`/settings/teams/new`}>
            <Button as="a" size="sm" colorScheme="orange">
              <HStack spacing={2}>
                <Plus size={20} />
                <Text>Add new team</Text>
              </HStack>
            </Button>
          </NextLink>
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Members</Th>
                  <Th>Projects</Th>
                </Tr>
              </Thead>
              <Tbody>
                {teams.map((team) => (
                  <LinkBox as="tr" key={team.id}>
                    <Td>
                      <LinkOverlay
                        as={NextLink}
                        href={`/settings/teams/${team.slug}`}
                        _hover={{ textDecoration: "underline" }}
                      >
                        {team.name}
                      </LinkOverlay>
                    </Td>
                    <Td>
                      {team.members.length}{" "}
                      {team.members.length == 1 ? "member" : "members"}
                    </Td>
                    <Td>
                      {team.projects.length}{" "}
                      {team.projects.length == 1 ? "project" : "projects"}
                    </Td>
                  </LinkBox>
                ))}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
