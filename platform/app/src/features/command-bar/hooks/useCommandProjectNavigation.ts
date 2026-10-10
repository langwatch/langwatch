import { useMemo } from "react";
import {
  type ProjectNavigation,
  projectNavigation,
} from "~/components/sidebar/projectKindNavigation";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * What the current project's navigation shows, read from the same rule the
 * sidebar reads. Quick Search also opens on organization pages, which hold
 * no project and so keep every section.
 */
export function useCommandProjectNavigation(): ProjectNavigation {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  return useMemo(() => projectNavigation(project?.kind), [project?.kind]);
}
