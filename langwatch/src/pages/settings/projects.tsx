import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  LinkBox,
  LinkOverlay,
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
import React from "react";
import { Plus } from "react-feather";
import SettingsLayout from "../../components/SettingsLayout";
import { ProjectTechStackIcon } from "../../components/TechStack";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type {
  FullyLoadedOrganization,
  TeamWithProjects,
} from "../../server/api/routers/organization";
import { TeamRoleGroup } from "../../server/api/permission";

export default function Projects() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return null;

  return <ProjectsList organization={organization} />;
}

function ProjectsList({
  organization,
}: {
  organization: FullyLoadedOrganization;
}) {
  const { hasTeamPermission } = useOrganizationTeamProject();

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
            Projects
          </Heading>
        </HStack>
        <Card width="full">
          <CardBody width="full" paddingY={0} paddingX={0}>
            <Table variant="simple" width="full">
              {organization.teams.map((team) => (
                <React.Fragment key={team.id}>
                  <Thead key={team.id}>
                    <Tr>
                      <Th>{team.name}</Th>
                      <Td textAlign="right">
                        {hasTeamPermission(
                          TeamRoleGroup.TEAM_CREATE_NEW_PROJECTS,
                          team
                        ) && (
                          <Button
                            as={NextLink}
                            href={`/onboarding/${team.slug}/project`}
                            size="sm"
                            colorScheme="orange"
                          >
                            <HStack spacing={2}>
                              <Plus size={20} />
                              <Text>Add new project</Text>
                            </HStack>
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  </Thead>
                  <TeamProjectsList team={team} />
                </React.Fragment>
              ))}
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}

export function TeamProjectsList({ team }: { team: TeamWithProjects }) {
  return (
    <Tbody>
      {team.projects.map((project) => (
        <Tr key={project.id}>
          <LinkBox>
            <Td>
              <HStack gap={2}>
                <ProjectTechStackIcon project={project} />
                <LinkOverlay as={NextLink} href={`/${project.slug}/messages`}>
                  {project.name}
                </LinkOverlay>
              </HStack>
            </Td>
          </LinkBox>
        </Tr>
      ))}
      {team.projects.length === 0 && (
        <Tr>
          <Td>
            <Text>No projects on this team</Text>
          </Td>
        </Tr>
      )}
    </Tbody>
  );
}
