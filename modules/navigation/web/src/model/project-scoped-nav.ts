import type { NavigationProject } from "./navigation-host.ts";

const PROJECT_PLACEHOLDER = "[project]";

/**
 * Where a sidebar item points, or why it cannot point anywhere yet: a
 * project is created for most signups but not all, and such a destination
 * has nowhere to go until there is one — so it carries a reason and stays put.
 */
export type ProjectScopedDestination =
  | { href: string; unavailableReason?: undefined }
  | { href?: undefined; unavailableReason: string };

export const projectScopedDestination = ({
  path,
  label,
  project,
}: {
  path: string;
  label: string;
  project?: Pick<NavigationProject, "slug">;
}): ProjectScopedDestination => {
  if (!path.includes(PROJECT_PLACEHOLDER)) {
    return { href: path };
  }
  if (!project) {
    return { unavailableReason: `Create a project first to open ${label}.` };
  }
  return { href: path.replace(PROJECT_PLACEHOLDER, project.slug) };
};
