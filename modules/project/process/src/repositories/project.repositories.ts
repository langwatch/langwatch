import type { ProjectRepository } from "./project.repository.ts";

/**
 * The rows the project module owns, chosen once at boot. The recent-items
 * strip and coding-agent activity stamps read other modules' tables through
 * their own narrow seams, so they are not part of this selection.
 */
export interface ProjectRepositories {
  readonly projects: ProjectRepository;
}
