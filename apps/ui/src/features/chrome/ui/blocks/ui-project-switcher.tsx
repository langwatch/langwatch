/**
 * The project switcher, as this application answers it.
 */

import {
  ProjectSwitcherCombobox,
  useOptionalNavigationHost,
  useProjectPickGroups,
} from "@langwatch/navigation-web/chrome";

export function UiProjectSwitcher() {
  const host = useOptionalNavigationHost();
  const project = host?.project();
  const groups = useProjectPickGroups();

  // Nothing to switch between is nothing to render: a single-project reader
  // gets the page's own title rather than a control that only ever answers
  // with where they already are.
  const projectCount = groups.reduce((total, group) => total + group.projects.length, 0);
  if (!project || projectCount < 2) return null;

  return (
    <ProjectSwitcherCombobox
      groups={groups}
      currentProjectId={project.id}
      currentProjectName={project.name}
      showTeamHeaders={groups.length > 1}
      onCreateProjectForTeam={void 0}
    />
  );
}
