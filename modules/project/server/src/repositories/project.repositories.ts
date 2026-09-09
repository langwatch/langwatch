import type { ProjectRepository } from "./project.repository.ts";

/**
 * The rows the project module owns, chosen once at boot.
 *
 * The recent-items strip and the coding-agent activity stamps read other
 * modules' tables through their own narrow seams, so they are not part of the
 * selection the app is built from.
 */
export interface ProjectRepositories {
  readonly projects: ProjectRepository;
}
