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
  /** One decision covering every project read: the manage standing of each, by project id. */
  decideManageable: (input: {
    organizationId: string;
    projectIds: readonly string[];
    by: Actor;
  }) => Promise<ReadonlyMap<string, boolean>>;
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
   * The screen is organisation-wide, so its answer is too: a row only for a
   * project the caller may manage. Which those are is known only once read,
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
    if (candidates.length === 0) return [];

    const manageable = await this.options.decideManageable({
      organizationId,
      projectIds: candidates.map((candidate) => candidate.projectId),
      by,
    });

    return candidates.filter((candidate) => manageable.get(candidate.projectId) === true);
  }
}
