import type { Project } from "~/generated/prisma/client";

const PROJECT_PLACEHOLDER = "[project]";

/**
 * Where a sidebar item points, or why it cannot point anywhere yet. A project
 * is created for most signups but not all of them, and a destination inside a
 * project has nowhere to go until there is one. Sending those items somewhere
 * else instead makes the whole rail lie about what it does, so they carry a
 * reason and stay put.
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
  project?: Pick<Project, "slug">;
}): ProjectScopedDestination => {
  if (!path.includes(PROJECT_PLACEHOLDER)) {
    return { href: path };
  }
  if (!project) {
    return { unavailableReason: `Create a project first to open ${label}.` };
  }
  return { href: path.replace(PROJECT_PLACEHOLDER, project.slug) };
};
