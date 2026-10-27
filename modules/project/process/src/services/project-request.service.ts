import { ProjectPermissionDeniedError } from "@langwatch/authorization";
import {
  CannotArchiveCurrentProjectError,
  type ProjectApi,
  type ProjectLegacyKey,
} from "@langwatch/project-contract";

type Actor = Readonly<{ id: string }>;

type ProjectRequestOptions = Readonly<{
  projects: ProjectApi;
  /** Every live legacy key in the organisation, before anyone's standing is asked about. */
  findLegacyKeys: (input: { organizationId: string }) => Promise<ProjectLegacyKey[]>;
  probePermission: (input: {
    permission: "project:delete" | "project:manage";
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

  /**
   * The API keys screen is organisation-wide, so its answer is too: every
   * project with a live legacy key the caller may manage, and no row for one
   * they may not. Which projects those are is only known once they are read,
   * which is why the standing is asked here and not on the route.
   */
  async findLegacyKeys({
    organizationId,
    by,
  }: {
    organizationId: string;
    by: Actor;
  }): Promise<ProjectLegacyKey[]> {
    const candidates = await this.options.findLegacyKeys({ organizationId });
    const manageable = await Promise.all(
      candidates.map((candidate) =>
        this.options.probePermission({
          permission: "project:manage",
          scope: { tier: "project", id: candidate.projectId },
          by,
        }),
      ),
    );

    return candidates.filter((_, index) => manageable[index] === true);
  }
}
