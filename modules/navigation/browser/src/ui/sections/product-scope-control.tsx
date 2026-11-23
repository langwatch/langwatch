/**
 * Product-native scope in top bar. Groups from useProjectPickItems (host's
 * workspace graph), with a per-team "New Project" entry. Spec:
 * modules/navigation/specs/product-switcher-navigation.feature
 */

import { Badge, Box, HStack, Text } from "@langwatch/design-system/primitives";
import { CreateProjectDrawerToken } from "@langwatch/organization-client";
import { isAggregateProjectKind } from "@langwatch/project-contract";

import { useOpenBoardInShell } from "../../behavior/use-open-board.ts";
import {
  useProjectInViewPick,
  useProjectPickGroups,
} from "../../behavior/use-project-pick-groups.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import {
  isOrganizationDashboardsPath,
  isProjectScopedProduct,
  type ProductId,
} from "../../model/products.ts";
import { ProjectSwitcherCombobox } from "../blocks/project-switcher-combobox.tsx";

function ScopeDivider() {
  return (
    <Box width="1px" height="20px" background="border.emphasized" marginX={1} flexShrink={0} />
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
        <Text textStyle="bodySm" whiteSpace="nowrap">
          {name}
        </Text>
        <Badge variant="outline" textStyle="micro" color="fg.muted" borderRadius="md">
          Personal
        </Badge>
      </HStack>
    </>
  );
}

/**
 * The project scope (LLM Ops): the current project as a chip, opening a searchable list of the
 * organization's projects (plus a per-team create entry). On a board, a pick follows the board's
 * rule (`projectPickHref`). Organization choice lives in its own control.
 */
function ProjectScopeMenu() {
  const host = useNavigationHost();
  const organization = host.organization();
  const project = host.project();
  const openBoard = useOpenBoardInShell();
  const groups = useProjectPickGroups({ openBoard });
  const onOpenProject = useProjectInViewPick({ openBoard });

  if (!organization || !project) return null;

  const onCreateProjectForTeam = ({ teamId, orgId }: { teamId: string; orgId: string }) =>
    host.openDrawerByToken(CreateProjectDrawerToken, {
      navigateOnCreate: true,
      defaultTeamId: teamId,
      organizationId: orgId,
    });

  const showTeamHeaders = groups.length > 1;
  const currentProjectIsAggregate = isAggregateProjectKind(project.kind);

  return (
    <>
      <ScopeDivider />
      <ProjectSwitcherCombobox
        groups={groups}
        currentProjectId={project.id}
        currentProjectName={project.name}
        currentProjectIsAggregate={currentProjectIsAggregate}
        showTeamHeaders={showTeamHeaders}
        onCreateProjectForTeam={onCreateProjectForTeam}
        onOpenProject={onOpenProject}
      />
    </>
  );
}

/**
 * The product-native scope in the top bar: project products show the project chip, Me a
 * Personal badge, organization-wide products and the organization's Dashboards nothing
 * (ADR-002). A board draws its home product's scope (D2); a project's Dashboards keeps its chip.
 */
export function ProductScopeControl({ activeProductId }: { activeProductId: ProductId | null }) {
  const pathname = useNavigationHost().pathname();
  if (activeProductId === "dashboards" && isOrganizationDashboardsPath(pathname)) return null;
  // Each scope renders its own leading divider, so a scope that has
  // nothing to show leaves no separator behind it.
  if (isProjectScopedProduct(activeProductId)) return <ProjectScopeMenu />;
  if (activeProductId === "me") return <MeScopeChip />;
  return null;
}
