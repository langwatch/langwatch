/**
 * The project switcher, as this application answers it.
 */

import { useDrawer } from "@langwatch/ui-drawer";
import {
  ProjectSwitcherCombobox,
  useOptionalNavigationHost,
  useProjectPickGroups,
} from "@langwatch/navigation-web/chrome";

export function UiProjectSwitcher() {
  const host = useOptionalNavigationHost();
  const project = host?.project();
  const groups = useProjectPickGroups();
  const { openDrawer } = useDrawer();

  // Nothing to switch between is nothing to render: a single-project reader
  // with no team to start a second project in gets the page's own title.
  // A team offering "New Project" keeps the switcher up at one project too,
  // so a coding-usage signup — whose only shared team starts empty — has a
  // path to it from here.
  const projectCount = groups.reduce((total, group) => total + group.projects.length, 0);
  const canCreateSomewhere = groups.some((group) => group.team.canCreateProject);
  if (!project || (projectCount < 2 && !canCreateSomewhere)) return null;

  return (
    <ProjectSwitcherCombobox
      groups={groups}
      currentProjectId={project.id}
      currentProjectName={project.name}
      showTeamHeaders={groups.length > 1}
      onCreateProjectForTeam={({ teamId }) => {
        openDrawer("createProject", { defaultTeamId: teamId });
      }}
    />
  );
}
