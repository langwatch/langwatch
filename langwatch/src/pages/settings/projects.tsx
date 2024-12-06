import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Link,
  LinkBox,
  LinkOverlay,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
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
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";

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
  const { project } = useOrganizationTeamProject();
  const { hasTeamPermission } = useOrganizationTeamProject();

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization.id },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );

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
                        ) &&
                          (!usage.data ||
                          usage.data.projectsCount <
                            usage.data.activePlan.maxProjects ||
                          usage.data.activePlan.overrideAddingLimitations ? (
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
                          ) : (
                            <Tooltip label="You reached the limit of max new projects, click to upgrade your plan to add more projects">
                              <Link
                                href={`/settings/subscription`}
                                _hover={{
                                  textDecoration: "none",
                                }}
                                onClick={() => {
                                  trackEvent("subscription_hook_click", {
                                    project_id: project?.id,
                                    hook: "new_project_limit_reached_2",
                                  });
                                }}
                              >
                                <Button
                                  background="gray.50"
                                  _hover={{ background: "gray.50" }}
                                  color="gray.400"
                                >
                                  <HStack spacing={2}>
                                    <Plus size={20} />
                                    <Text>Add new project</Text>
                                  </HStack>
                                </Button>
                              </Link>
                            </Tooltip>
                          ))}
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
          <Td colSpan={2}>
            <LinkBox>
              <HStack width="full" gap={2} data-project-id={project.id}>
                <ProjectTechStackIcon project={project} />
                <LinkOverlay as={NextLink} href={`/${project.slug}/messages`}>
                  {project.name}
                </LinkOverlay>
              </HStack>
            </LinkBox>
          </Td>
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
