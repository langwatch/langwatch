import { Box, Button, HStack, Portal, Text } from "@chakra-ui/react";
import { ChevronDown, Plus } from "lucide-react";
import React, { useState } from "react";
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  type Team,
} from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";
import { useRouter } from "~/utils/compat/next-router";
import { buildProjectSwitchHref } from "~/utils/routes";
import { ProjectAvatar } from "./ProjectAvatar";
import { Link } from "./ui/link";
import { Menu } from "./ui/menu";

/**
 * A standalone project dropdown for pages that sit outside the
 * navigation shells' scope but still need to switch projects, such as
 * the CLI authorize screens and the secrets settings page.
 */
export const ProjectSelector = React.memo(function ProjectSelector({
  organizations,
  project,
}: {
  organizations: FullyLoadedOrganization[];
  project: Project;
}) {
  const router = useRouter();
  const { data: session } = useRequiredSession();
  const [open, setOpen] = useState(false);

  const sortByName = (a: { name: string }, b: { name: string }) =>
    a.name.toLowerCase() < b.name.toLowerCase()
      ? -1
      : a.name.toLowerCase() > b.name.toLowerCase()
        ? 1
        : 0;

  const projectGroups = organizations.sort(sortByName).flatMap((organization) =>
    organization.teams.flatMap((team) => ({
      organization,
      team,
      projects: team.projects.sort(sortByName),
    })),
  );

  return (
    <Menu.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          fontSize="13px"
          paddingX={2}
          paddingY={1}
          height="auto"
          fontWeight="normal"
          minWidth="fit-content"
          color="fg"
          _hover={{
            backgroundColor: "bg.muted",
          }}
        >
          <HStack gap={2}>
            <ProjectAvatar name={project.name} />
            <Text>{project.name}</Text>
            <ChevronDown size={14} />
          </HStack>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Box zIndex="popover" padding={0}>
          {open && (
            <Menu.Content>
              {projectGroups
                .filter((projectGroup) => {
                  // Org admins created via RoleBinding-only flow have no TeamUser row
                  // but still have full access. Resolve the current user's
                  // organization role explicitly rather than relying on
                  // members[0] being pre-filtered.
                  const currentUserOrgRole =
                    projectGroup.organization.members.find(
                      (m) => m.userId === session?.user.id,
                    )?.role;
                  return (
                    currentUserOrgRole === OrganizationUserRole.ADMIN ||
                    (projectGroup.team.members?.some(
                      (member) => member.userId === session?.user.id,
                    ) ??
                      false)
                  );
                })
                .map((projectGroup) => (
                  <Menu.ItemGroup
                    key={projectGroup.team.id}
                    title={
                      projectGroup.organization.name +
                      (projectGroup.team.name !== projectGroup.organization.name
                        ? " - " + projectGroup.team.name
                        : "")
                    }
                  >
                    {projectGroup.projects.map((project_) => (
                      <Menu.Item
                        key={project_.id}
                        value={project_.id}
                        fontSize="14px"
                        asChild
                      >
                        <Link
                          key={project_.id}
                          href={buildProjectSwitchHref({
                            routePattern: router.pathname,
                            resolvedPathname: window.location.pathname,
                            currentProjectSlug: project.slug,
                            targetSlug: project_.slug,
                            homeFallback: "returnTo",
                          })}
                          onClick={() => {
                            const currentPath = window.location.pathname;
                            const hasProjectInPath = currentPath.includes(
                              project.slug,
                            );
                            if (!hasProjectInPath) {
                              localStorage.setItem(
                                "selectedProjectSlug",
                                JSON.stringify(project_.slug),
                              );
                            }
                          }}
                          _hover={{
                            textDecoration: "none",
                          }}
                        >
                          <HStack gap={2}>
                            <ProjectAvatar name={project_.name} />
                            <Text>{project_.name}</Text>
                          </HStack>
                        </Link>
                      </Menu.Item>
                    ))}
                    <AddProjectButton
                      team={projectGroup.team}
                      organization={projectGroup.organization}
                    />
                  </Menu.ItemGroup>
                ))}
            </Menu.Content>
          )}
        </Box>
      </Portal>
    </Menu.Root>
  );
});

export const AddProjectButton = ({
  team,
  organization,
}: {
  team: Team;
  organization: Organization;
}) => {
  const { openDrawer } = useDrawer();

  return (
    <Menu.Item
      value={`new-project-${team.slug}`}
      fontSize="14px"
      onClick={() =>
        openDrawer("createProject", {
          navigateOnCreate: true,
          defaultTeamId: team.id,
          organizationId: organization.id,
        })
      }
    >
      <Plus />
      New Project
    </Menu.Item>
  );
};
