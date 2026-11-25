import {
  BRAIDS_FLAG,
  BraidsNotEnabledError,
  BraidsTurnedOffError,
} from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

import type { AuthzOrganizationPolicyRepository } from "../repositories/authz-organization-policy.repository.ts";
import type { AuthzReadRepository } from "../repositories/authz-read.repository.ts";

/**
 * Two gates on braid management (ADR-201 §9): `release_braids`, LangWatch's kill switch, refuses
 * `braids_not_enabled` and fails closed with no organisation; the organisation's own "Braids
 * enabled" setting refuses `braids_turned_off`. Specs: braids-release-flag.feature, braids.feature.
 */
export class AuthzBraidReleaseService {
  static create(deps: {
    flags: Pick<FeatureFlagApi, "isEnabled">;
    lineage: Pick<AuthzReadRepository, "findProjectLineages">;
    policies: Pick<AuthzOrganizationPolicyRepository, "getPolicy">;
  }): AuthzBraidReleaseService {
    return new AuthzBraidReleaseService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof AuthzBraidReleaseService.create>[0],
  ) {}

  /** Released for the project's organisation, and turned on in its settings. */
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
    await this.assertTurnedOn({ organizationId });
  }

  /** The flag alone: the organisation's settings stay reachable while Braids is turned off. */
  async assertReleasedForOrganization({
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

  private async assertTurnedOn({ organizationId }: { organizationId: string }): Promise<void> {
    const policy = await this.deps.policies.getPolicy({ organizationId });
    if (!policy.braidsEnabled) throw new BraidsTurnedOffError();
  }
}
