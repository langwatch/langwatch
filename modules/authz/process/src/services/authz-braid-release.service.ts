import { BRAIDS_FLAG, BraidsNotEnabledError } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

import type { AuthzReadRepository } from "../repositories/authz-read.repository.ts";

/**
 * The `release_braids` gate on braid management. The browser flag only hides the pages; this
 * refuses, failing closed on a project with no organisation. Braids already made keep applying:
 * nothing on the read path asks it (modules/authz/specs/braids-release-flag.feature).
 */
export class AuthzBraidReleaseService {
  static create(deps: {
    flags: Pick<FeatureFlagApi, "isEnabled">;
    lineage: Pick<AuthzReadRepository, "findProjectLineages">;
  }): AuthzBraidReleaseService {
    return new AuthzBraidReleaseService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof AuthzBraidReleaseService.create>[0],
  ) {}

  async assertEnabledForProject({ projectId }: { projectId: string }): Promise<void> {
    const lineages = await this.deps.lineage.findProjectLineages({ projectIds: [projectId] });
    const organizationId = lineages.get(projectId)?.organizationId;
    if (!organizationId) throw new BraidsNotEnabledError();
    const enabled = await this.deps.flags.isEnabled(BRAIDS_FLAG, {
      kind: "project",
      projectId,
      organizationId,
    });
    if (!enabled) throw new BraidsNotEnabledError();
  }

  async assertEnabledForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    const enabled = await this.deps.flags.isEnabled(BRAIDS_FLAG, {
      kind: "organization",
      organizationId,
    });
    if (!enabled) throw new BraidsNotEnabledError();
  }
}
