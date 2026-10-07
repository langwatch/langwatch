import { ProjectPermissionDeniedError } from "@langwatch/authorization";
import { CannotArchiveCurrentProjectError, type ProjectApi } from "@langwatch/project-contract";

type Actor = Readonly<{ id: string }>;

type ProjectRequestOptions = Readonly<{
  projects: ProjectApi;
  probePermission: (input: {
    permission: "project:delete";
    scope: { tier: "project"; id: string };
    by: Actor;
  }) => Promise<boolean>;
}>;

/** The decisions the project browser door makes around one project call. */
export class ProjectRequestService {
  private constructor(private readonly options: ProjectRequestOptions) {}

  static create(options: ProjectRequestOptions): ProjectRequestService {
    return new ProjectRequestService(options);
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
}
