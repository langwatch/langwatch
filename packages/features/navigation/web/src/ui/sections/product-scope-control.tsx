/**
 * The product-native scope in the shell's top bar.
 *
 * Moved from
 * `platform/app/src/features/navigation/shell/ProductScopeControl.tsx`. The
 * groups it offered came from `useWorkspaceData`, a `platform/app` hook that
 * no longer exists; this package already publishes the same answer —
 * `useProjectPickItems` builds the groups from the host's own workspace graph,
 * and it is what the project switcher in the application chrome reads too.
 *
 * The per-team "New Project" entry is not offered, the narrowing the switcher
 * move already recorded: it opened the create-project drawer, which is a
 * `platform/app` component.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */

import { Badge, Box, Button, HStack, Portal, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Check, ChevronsUpDown } from "lucide-react";
import { useNavigationHost } from "../../model/navigation-host";
import { useProjectPickGroups } from "../../behavior/use-project-pick-groups";
import type { ProjectPickGroup } from "../../model/project-pick-items";
import type { ProductId } from "../../model/products";
import { ProjectAvatar } from "../elements/project-avatar";
import { NavigationLink } from "../elements/navigation-link";
import { ProjectSwitcherCombobox } from "../blocks/project-switcher-combobox";

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
  const name = useNavigationHost().currentUser()?.name;
  if (!name) return null;
  return (
    <>
      <ScopeDivider />
      <HStack gap={2} paddingX={1.5} minWidth={0}>
        <Text fontSize="13px" whiteSpace="nowrap">
          {name}
        </Text>
        <Badge variant="outline" fontSize="10px" color="fg.muted" borderRadius="md">
          Personal
        </Badge>
      </HStack>
    </>
  );
}

/**
 * Above this many projects the plain menu turns into a searchable
 * combobox: the list no longer fits a screen, so finding beats reading.
 */
const PROJECT_SEARCH_THRESHOLD = 8;

/**
 * The LLM Ops scope: the current project as a chip, opening a menu with
 * the organization's projects (and a per-team create entry where the
 * user can create one). Organization choice lives in its own control,
 * so this menu stays within the current organization. Past
 * PROJECT_SEARCH_THRESHOLD projects the menu becomes a combobox that
 * opens with a focused search field.
 */
function ProjectScopeMenu() {
  const host = useNavigationHost();
  const organization = host.organization();
  const project = host.project();
  const groups = useProjectPickGroups();

  if (!organization || !project) return null;

  const projectCount = groups.reduce((count, group) => count + group.projects.length, 0);
  const showTeamHeaders = groups.length > 1;

  return (
    <>
      <ScopeDivider />
      {projectCount > PROJECT_SEARCH_THRESHOLD ? (
        <ProjectSwitcherCombobox
          groups={groups}
          currentProjectId={project.id}
          currentProjectName={project.name}
          showTeamHeaders={showTeamHeaders}
          onCreateProjectForTeam={void 0}
        />
      ) : (
        <ProjectMenu
          groups={groups}
          currentProjectId={project.id}
          currentProjectName={project.name}
          showTeamHeaders={showTeamHeaders}
        />
      )}
    </>
  );
}

/** The plain project menu, for a list short enough to read whole. */
function ProjectMenu({
  groups,
  currentProjectId,
  currentProjectName,
  showTeamHeaders,
}: {
  groups: ProjectPickGroup[];
  currentProjectId: string;
  currentProjectName: string;
  showTeamHeaders: boolean;
}) {
  return (
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
          <ProjectAvatar name={currentProjectName} />
          <Text whiteSpace="nowrap">{currentProjectName}</Text>
          <ChevronsUpDown size={12} color="var(--chakra-colors-fg-muted)" />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Content minWidth="240px">
          {groups.map(({ team, projects: teamProjects }) => (
            <Menu.ItemGroup
              key={team.teamId}
              title={showTeamHeaders ? team.label : "Projects"}
            >
              {teamProjects.map((candidate) => (
                <Menu.Item
                  key={candidate.projectId}
                  value={candidate.projectId}
                  fontSize="13px"
                  asChild
                >
                  <NavigationLink href={candidate.href} _hover={{ textDecoration: "none" }}>
                    <HStack gap={2} width="full">
                      <ProjectAvatar name={candidate.label} />
                      <Text flex={1}>{candidate.label}</Text>
                      {candidate.projectId === currentProjectId && (
                        <Check size={13} aria-label="Current project" />
                      )}
                    </HStack>
                  </NavigationLink>
                </Menu.Item>
              ))}
            </Menu.ItemGroup>
          ))}
        </Menu.Content>
      </Portal>
    </Menu.Root>
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
