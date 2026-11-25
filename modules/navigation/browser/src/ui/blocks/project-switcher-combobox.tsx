import { ProjectPicker, type ProjectPickerGroup } from "@langwatch/design-system/project-picker";

import { useNavigationHost } from "../../model/navigation-host.ts";

/**
 * The top bar's project switch: the design system's one project picker, which
 * project's lent switcher draws on settings pages too, following picks through
 * the host. Spec: modules/navigation/specs/product-switcher-navigation.feature
 */
export function ProjectSwitcherCombobox({
  groups,
  currentProjectId,
  currentProjectName,
  currentProjectIsAggregate = false,
  showTeamHeaders,
  onCreateProjectForTeam,
  onOpenProject,
}: {
  groups: ProjectPickerGroup[];
  currentProjectId: string;
  currentProjectName: string;
  currentProjectIsAggregate?: boolean;
  showTeamHeaders: boolean;
  onCreateProjectForTeam:
    | (({ teamId, orgId }: { teamId: string; orgId: string }) => void)
    | undefined;
  /** Takes a pick instead of navigating to its address; absent, the pick navigates. */
  onOpenProject?: (href: string) => void;
}) {
  const host = useNavigationHost();
  return (
    <ProjectPicker
      groups={groups}
      currentProjectId={currentProjectId}
      currentProjectName={currentProjectName}
      currentProjectIsAggregate={currentProjectIsAggregate}
      showTeamHeaders={showTeamHeaders}
      onOpenProject={onOpenProject ?? ((href) => host.navigate(href))}
      onCreateProjectForTeam={onCreateProjectForTeam}
      triggerTestId="navigation-project-switcher"
      tourAnchor="project-switcher"
    />
  );
}
