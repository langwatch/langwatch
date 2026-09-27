import { ProjectPermissionDeniedError } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  CannotArchiveCurrentProjectError,
  ProjectNotFoundError,
  type Project,
  type ProjectApi,
  type TopicClusteringRequest,
} from "@langwatch/project-contract";

type Actor = Readonly<{ id: string }>;

export type ProjectRequestOptions = Readonly<{
  projects: ProjectApi;
  probePermission: (input: {
    permission: "project:delete";
    scope: { tier: "project"; id: string };
    by: Actor;
  }) => Promise<boolean>;
  reportTopicClusteringFailure: (error: unknown, context: { projectId: string }) => void;
}>;

/** The decisions the project browser door makes around one project call. */
export class ProjectRequestService {
  private constructor(private readonly options: ProjectRequestOptions) {}

  static create(options: ProjectRequestOptions): ProjectRequestService {
    return new ProjectRequestService(options);
  }

  async getProject({ projectId }: { projectId: string }): Promise<Project> {
    const project = await this.options.projects.findById(projectId);
    if (!project) throw new ProjectNotFoundError();

    return project;
  }

  /**
   * The declared check covered `projectId`, the project the caller is in. The
   * project archived is the other one, so it is probed on its own first.
   */
  async archiveOtherProject({
    projectId,
    projectToArchiveId,
    by,
  }: {
    projectId: string;
    projectToArchiveId: string;
    by: Actor;
  }): Promise<{ alreadyArchived: boolean }> {
    if (projectToArchiveId === projectId) throw new CannotArchiveCurrentProjectError();

    const canDeleteTarget = await this.options.probePermission({
      permission: "project:delete",
      scope: { tier: "project", id: projectToArchiveId },
      by,
    });
    if (!canDeleteTarget) throw new ProjectPermissionDeniedError("project:delete");

    return this.options.projects.archive({ projectId: projectToArchiveId });
  }

  /**
   * A refusal the deployment already named is re-raised untouched; anything
   * else is event-store internals, so it stays an ordinary error the boundary
   * degrades to an unknown failure with a trace id.
   */
  async triggerTopicClustering({
    projectId,
    by,
  }: {
    projectId: string;
    by: Actor;
  }): Promise<TopicClusteringRequest> {
    try {
      return await this.options.projects.requestTopicClustering({ projectId }, by);
    } catch (error) {
      this.options.reportTopicClusteringFailure(error, { projectId });
      if (HandledError.isHandled(error)) throw error;
      throw new Error("Failed to trigger topic clustering", { cause: error });
    }
  }
}
