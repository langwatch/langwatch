import type { Project, UpdateProjectInput } from "./project.ts";
import type { TopicClusteringRequest } from "./project.responses.ts";

/** Who a write is attributed to. */
export interface ProjectCaller {
  readonly id: string;
}

/**
 * The project feature's portable operation surface: what its doors call.
 *
 * A transport is handed one of these and nothing else, so a REST handler and a
 * tRPC procedure invoke the same operation. A caller arrives as an argument,
 * never read from a session or a request, which is what lets one operation
 * serve a browser session, an API key and a background job.
 */
export abstract class ProjectApi {
  /** One project, or absent when nothing by that id exists. */
  abstract tryGetById(id: string): Promise<Project | null>;

  /** The organization a project belongs to. */
  abstract getOrganizationId(projectId: string): Promise<string>;

  /** Provisions a project, attributed to the caller who asked for it. */
  abstract create(
    input: Readonly<{
      organizationId: string;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
    }>,
    by: ProjectCaller,
  ): Promise<Project>;

  /** Writes the project settings form; secret fields arrive as ciphertext. */
  abstract updateSettings(
    input: Readonly<UpdateProjectInput & { projectId: string }>,
  ): Promise<Project>;

  /** Archives a project by id; a project already gone answers "already archived". */
  abstract archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }>;

  /** Rotates the legacy project write credential. */
  abstract regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string>;

  /** Asks the scheduler for a manual topic-clustering run. */
  abstract requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: ProjectCaller,
  ): Promise<TopicClusteringRequest>;
}
