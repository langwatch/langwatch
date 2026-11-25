import type { OrganizationApi } from "@langwatch/organization-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

/** The peers the checkup's hidden project is created and found through. */
export type CheckupCanaryProjectPeers = Readonly<{
  organizations: Pick<OrganizationApi, "ensureSystemOrganization">;
  projects: Pick<ProjectApi, "ensureInternal" | "findInternalIds">;
}>;

/**
 * The hidden system organization's checkup project, where the canaries and the storage probe
 * run: created once by step `ops:checkup-canary-project`, never by a checkup run.
 * Spec: modules/ops/specs/checkup-canary-project.feature.
 */
export class CheckupCanaryProjectService {
  private constructor(private readonly peers: CheckupCanaryProjectPeers) {}

  static create(peers: CheckupCanaryProjectPeers): CheckupCanaryProjectService {
    return new CheckupCanaryProjectService(peers);
  }

  /** Creates the organization and its project when no checkup project lives yet. */
  async ensure({
    dryRun,
  }: {
    dryRun: boolean;
  }): Promise<{ projectId: string; created: boolean } | { wouldCreate: true }> {
    const existing = await findCheckupProjectId({ projects: this.peers.projects });
    if (existing) return { projectId: existing, created: false };
    if (dryRun) return { wouldCreate: true };

    const { id: organizationId } = await this.peers.organizations.ensureSystemOrganization();
    const project = await this.peers.projects.ensureInternal({
      organizationId,
      kind: PROJECT_KIND.INTERNAL_CHECKUP,
    });
    return { projectId: project.id, created: true };
  }
}

/** The checkup project's id, or undefined before its migration step has run. */
export async function findCheckupProjectId({
  projects,
}: {
  projects: Pick<ProjectApi, "findInternalIds">;
}): Promise<string | undefined> {
  const ids = await projects.findInternalIds({ kind: PROJECT_KIND.INTERNAL_CHECKUP });
  return ids.toSorted()[0];
}
