import {
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import React from "react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { toaster } from "../../components/ui/toaster";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type {
  FullyLoadedOrganization,
  TeamWithProjectsAndMembers,
} from "../../server/api/routers/organization";
import { api } from "../../utils/api";

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
  const { hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={2}
        gap={6}
        width="full"
        align="start"
        maxWidth="1280px"
      >
        <HStack width="full" justifyContent="space-between">
          <Heading size="lg">Projects</Heading>
          {hasPermission("project:create") && (
            <PageLayout.HeaderButton
              onClick={() => openDrawer("createProject")}
            >
              <Plus size={20} />
              <Text>Add new project</Text>
            </PageLayout.HeaderButton>
          )}
        </HStack>
        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" width="full" size="md">
              {organization.teams.map((team) => (
                <React.Fragment key={team.id}>
                  <Table.Header key={team.id}>
                    <Table.Row>
                      <Table.ColumnHeader colSpan={2}>
                        {team.name}
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
                <ProjectAvatar name={teamProject.name} />
                <Link href={`/${teamProject.slug}`}>{teamProject.name}</Link>
              </HStack>
            </Box>
          </Table.Cell>
          <Table.Cell textAlign="right">
            {teamProject.id !== project?.id &&
              hasPermission("project:delete") && (
                <Button
                  variant="ghost"
                  color="red.fg"
                  size="sm"
                  aria-label="Archive project"
                  onClick={() => onArchiveProject(teamProject.id)}
                >
                  <Trash2 size={16} />
                </Button>
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
