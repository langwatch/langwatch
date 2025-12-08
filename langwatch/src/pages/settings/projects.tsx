import {
  Button,
  Card,
  HStack,
  Heading,
  Table,
  Text,
  VStack,
  Box,
} from "@chakra-ui/react";
import React from "react";
import { Menu } from "../../components/ui/menu";
import { Archive, MoreVertical, Plus } from "lucide-react";
import SettingsLayout from "../../components/SettingsLayout";
import { ProjectTechStackIcon } from "../../components/TechStack";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type {
  FullyLoadedOrganization,
  TeamWithProjectsAndMembers,
} from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { Link } from "../../components/ui/link";
import { Tooltip } from "../../components/ui/tooltip";
import { toaster } from "../../components/ui/toaster";

import { withPermissionGuard } from "../../components/WithPermissionGuard";

function Projects() {
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
  const { hasPermission } = useOrganizationTeamProject();

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization.id },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

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
            Projects
          </Heading>
        </HStack>
        <Card.Root width="full">
          <Card.Body width="full" paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full">
              {organization.teams.map((team) => (
                <React.Fragment key={team.id}>
                  <Table.Header key={team.id}>
                    <Table.Row>
                      <Table.ColumnHeader>{team.name}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="right">
                        {hasPermission("project:create") &&
                          (!usage.data ||
                          usage.data.projectsCount <
                            usage.data.activePlan.maxProjects ||
                          usage.data.activePlan.overrideAddingLimitations ? (
                            <Link
                              href={`/onboarding/${team.slug}/project`}
                              asChild
                            >
                              <Button size="sm" colorPalette="orange">
                                <HStack gap={2}>
                                  <Plus size={20} />
                                  <Text>Add new project</Text>
                                </HStack>
                              </Button>
                            </Link>
                          ) : (
                            <Tooltip
                              content="You reached the limit of max new projects, click to upgrade your plan to add more projects"
                              positioning={{ placement: "top" }}
                            >
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
                                  <HStack gap={2}>
                                    <Plus size={20} />
                                    <Text>Add new project</Text>
                                  </HStack>
                                </Button>
                              </Link>
                            </Tooltip>
                          ))}
                      </Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <TeamProjectsList team={team} />
                </React.Fragment>
              ))}
            </Table.Root>
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("project:view", {
  layoutComponent: SettingsLayout,
})(Projects);

export function TeamProjectsList({
  team,
}: {
  team: TeamWithProjectsAndMembers;
}) {
  const queryClient = api.useContext();
  const { project, hasPermission } = useOrganizationTeamProject();
  const archiveProject = api.project.archiveById.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Project archived successfully",
        type: "success",
      });
      void queryClient.organization.getAll.invalidate();
    },
  });

  const onArchiveProject = (projectId: string) => {
    if (!project) return;
    if (
      confirm(
        "Are you sure you want to archive this project? This action cannot be undone.",
      )
    ) {
      archiveProject.mutate({
        projectId: project.id,
        projectToArchiveId: projectId,
      });
    }
  };

  return (
    <Table.Body>
      {team.projects.map((teamProject) => (
        <Table.Row key={teamProject.id}>
          <Table.Cell>
            <Box as="div" cursor="pointer">
              <HStack width="full" gap={2} data-project-id={teamProject.id}>
                <ProjectTechStackIcon project={teamProject} />
                <Link href={`/${teamProject.slug}/messages`}>
                  {teamProject.name}
                </Link>
              </HStack>
            </Box>
          </Table.Cell>
          <Table.Cell textAlign="right">
            {teamProject.id !== project?.id &&
              hasPermission("project:delete") && (
                <Menu.Root>
                  <Menu.Trigger className="js-inner-menu">
                    <MoreVertical size={18} />
                  </Menu.Trigger>
                  <Menu.Content className="js-inner-menu">
                    <Menu.Item
                      value="delete"
                      color="red.500"
                      onClick={() => onArchiveProject(teamProject.id)}
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
      {team.projects.length === 0 && (
        <Table.Row>
          <Table.Cell colSpan={2}>
            <Text>No projects on this team</Text>
          </Table.Cell>
        </Table.Row>
      )}
    </Table.Body>
  );
}
