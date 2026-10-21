import type {
  AuthzOrganizationInput,
  AuthzOrganizationPolicy,
  AuthzSetBraidsPolicyInput,
} from "@langwatch/authz-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import type { AuthzAuditTrailRepository } from "../repositories/authz-audit-trail.repository.ts";
import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import type { AuthzOrganizationPolicyRepository } from "../repositories/authz-organization-policy.repository.ts";

export const BRAIDS_POLICY_CHANGED_ACTION = "authz.organization_policy.braids_changed";

/**
 * ADR-183 §2: an organisation can keep braids to its admins. A change is stored, audited, then
 * bumps the epoch so cached snapshots stop conferring braids:manage within the bound.
 */
export class AuthzOrganizationPolicyService {
  static create(deps: {
    policies: AuthzOrganizationPolicyRepository;
    epoch: Pick<AuthzEpochRepository, "bump">;
    auditTrail: AuthzAuditTrailRepository;
    now?: () => number;
  }): AuthzOrganizationPolicyService {
    return new AuthzOrganizationPolicyService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof AuthzOrganizationPolicyService.create>[0],
  ) {}

  getOrganizationPolicy({
    organizationId,
  }: AuthzOrganizationInput): Promise<AuthzOrganizationPolicy> {
    return this.deps.policies.getPolicy({ organizationId });
  }

  /** A repeat after a failed bump writes the same row again and moves the epoch. */
  async setBraidsPolicy({
    organizationId,
    braidsOrganizationAdminsOnly,
    actor,
  }: AuthzSetBraidsPolicyInput): Promise<AuthzOrganizationPolicy> {
    const previous = await this.deps.policies.getPolicy({ organizationId });
    const updatedByUserId = actor.id ?? actor.type;
    await this.deps.policies.setBraidsOrganizationAdminsOnly({
      organizationId,
      braidsOrganizationAdminsOnly,
      updatedByUserId,
    });
    const now = this.deps.now?.() ?? nowInstant().epochMilliseconds;
    await this.deps.auditTrail.insert({
      id: `authz-org-policy-${organizationId}-${now}`,
      createdAt: Temporal.Instant.fromEpochMilliseconds(now),
      userId: actor.type === "user" ? actor.id : null,
      organizationId,
      action: BRAIDS_POLICY_CHANGED_ACTION,
      metadata: {
        braidsOrganizationAdminsOnly,
        previous: previous.braidsOrganizationAdminsOnly,
      },
    });
    await this.deps.epoch.bump({ organizationId });
    return this.deps.policies.getPolicy({ organizationId });
  }
}
