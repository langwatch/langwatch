import { Badge, Box, Button, HStack, Portal, Text } from "@chakra-ui/react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { ProjectAvatar } from "~/components/ProjectAvatar";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { useWorkspaceData } from "~/components/useWorkspaceData";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import type { ProductId } from "../products";

function ScopeDivider() {
  return (
    <Box
      width="1px"
      height="20px"
      background="border.emphasized"
      marginX={1}
      flexShrink={0}
    />
  );
}

/**
 * The Me scope: the signed-in user with a Personal badge. Not a picker,
 * there is nothing to switch to inside the personal plane.
 */
function MeScopeChip() {
  const { data: session } = useRequiredSession();
  const name = session?.user?.name;
  if (!name) return null;
  return (
    <>
      <ScopeDivider />
      <HStack gap={2} paddingX={1.5} minWidth={0}>
        <Text fontSize="13px" whiteSpace="nowrap">
          {name}
        </Text>
        <Badge
          variant="outline"
          fontSize="10px"
          color="fg.muted"
          borderRadius="md"
        >
          Personal
        </Badge>
      </HStack>
    </>
  );
}

/**
 * The LLM Ops scope: the current project as a chip, opening a menu with
 * the organization's projects (and a per-team create entry where the
 * user can create one). Organization choice lives in its own control,
 * so this menu stays within the current organization.
 */
function ProjectScopeMenu() {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { teams, projects, onCreateProjectForTeam } = useWorkspaceData();

  if (!organization || !project) return null;

  const orgTeams = teams.filter((team) => team.orgId === organization.id);
  const groups = orgTeams
    .map((team) => ({
      team,
      projects: projects.filter(
        (candidate) =>
          candidate.orgId === organization.id &&
          candidate.teamId === team.teamId,
      ),
    }))
    .filter(
      (group) => group.projects.length > 0 || group.team.canCreateProject,
    );

  return (
    <>
      <ScopeDivider />
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            variant="ghost"
            aria-label="Switch project"
            fontSize="13px"
            fontWeight="normal"
            paddingX={2}
            height="32px"
            color="fg"
            gap={2}
            _hover={{ backgroundColor: "bg.muted" }}
          >
            <ProjectAvatar name={project.name} />
            <Text whiteSpace="nowrap">{project.name}</Text>
            <ChevronsUpDown size={12} color="var(--chakra-colors-fg-muted)" />
          </Button>
        </Menu.Trigger>
        <Portal>
          <Menu.Content minWidth="240px">
            {groups.map(({ team, projects: teamProjects }) => (
              <Menu.ItemGroup
                key={team.teamId}
                title={orgTeams.length > 1 ? team.label : "Projects"}
              >
                {teamProjects.map((candidate) => (
                  <Menu.Item
                    key={candidate.projectId}
                    value={candidate.projectId}
                    fontSize="13px"
                    asChild
                  >
                    <Link
                      href={candidate.href}
                      _hover={{ textDecoration: "none" }}
                    >
                      <HStack gap={2} width="full">
                        <ProjectAvatar name={candidate.label} />
                        <Text flex={1}>{candidate.label}</Text>
                        {candidate.projectId === project.id && (
                          <Check size={13} aria-label="Current project" />
                        )}
                      </HStack>
                    </Link>
                  </Menu.Item>
                ))}
                {team.canCreateProject && (
                  <Menu.Item
                    value={`new-project-${team.teamId}`}
                    fontSize="13px"
                    onClick={() =>
                      onCreateProjectForTeam?.({
                        teamId: team.teamId,
                        orgId: team.orgId,
                      })
                    }
                  >
                    <Plus size={13} /> New Project
                  </Menu.Item>
                )}
              </Menu.ItemGroup>
            ))}
          </Menu.Content>
        </Portal>
      </Menu.Root>
    </>
  );
}

/**
 * The product-native scope in the product-switcher top bar: LLM Ops
 * shows the project chip, Me shows the user with a Personal badge, and
 * the organization-wide products (Gateway, Governance) show nothing,
 * because the organization control already says it all.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
export function ProductScopeControl({
  activeProductId,
}: {
  activeProductId: ProductId | null;
}) {
  // Each scope renders its own leading divider, so a scope that has
  // nothing to show leaves no separator behind it.
  if (activeProductId === "llm-ops") return <ProjectScopeMenu />;
  if (activeProductId === "me") return <MeScopeChip />;
  return null;
}
