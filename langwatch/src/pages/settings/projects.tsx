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
import type { FullyLoadedOrganization } from "../../server/api/routers/organization";

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
                    <Tr borderRadius="10px">
                      <Th>{team.name}</Th>
                      <Td textAlign="right">
                        <NextLink href={`/onboarding/${team.slug}/project`}>
                          <Button as="a">
                            <HStack spacing={2}>
                              <Plus size={20} />
                              <Text>Add new project</Text>
                            </HStack>
                          </Button>
                        </NextLink>
                      </Td>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {team.projects.map((project) => (
                      <Tr key={project.id}>
                        <LinkBox>
                          <Td>
                            <HStack gap={2}>
                              <ProjectTechStackIcon project={project} />
                              <LinkOverlay href={`/${project.slug}/messages`}>
                                {project.name}
                              </LinkOverlay>
                            </HStack>
                          </Td>
                        </LinkBox>
                      </Tr>
                    ))}
                  </Tbody>
                </React.Fragment>
              ))}
            </Table>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
