/**
 * The project switcher, as this application answers it.
 *
 * `@langwatch/navigation-web` owns the control — the combobox, its search, its
 * keyboard and its rows — AND, since the shell moved, the groups too: which
 * projects to offer and where each one goes is `useProjectPickGroups`, read off
 * the navigation host. This block fetches nothing and computes nothing; it is
 * the seam that hands the control to a screen whose header wants one.
 *
 * WHY IT STILL EXISTS now that the shell draws its own. A screen's host port
 * carries this as a `ReactNode` — the organization family's audit log and the
 * secret family both take one — so the screen decides where in its own header
 * it goes. That is a different placement from the shell's top bar, and it is
 * why the control is read through the OPTIONAL host: a screen mounted where the
 * chrome layout route does not reach renders no switcher rather than crashing
 * on a header decoration.
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
