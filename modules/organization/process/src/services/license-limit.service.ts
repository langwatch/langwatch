import type { LimitCheckResult, LimitType } from "@langwatch/organization-contract";

import type {
  OrganizationInvitations,
  OrganizationPlanUser,
  OrganizationSeatLicense,
  OrganizationSignals,
} from "../app/organization.members.ts";

type LicenseLimitDependencies = {
  seats: Pick<OrganizationSeatLicense, "checkLimit">;
  /** Where a reached limit is told; none when the deployment composes no invitations. */
  notices: Pick<OrganizationInvitations, "notifySeatLimitReached"> | null;
  signals: Pick<OrganizationSignals, "reportError">;
};

/** The `licenseEnforcement.*` answers: the seat limits a plan puts on an organization. */
export class LicenseLimitService {
  static create(dependencies: LicenseLimitDependencies): LicenseLimitService {
    return new LicenseLimitService(dependencies);
  }

  private constructor(private readonly dependencies: LicenseLimitDependencies) {}

  check(
    { organizationId, limitType }: Readonly<{ organizationId: string; limitType: LimitType }>,
    by: OrganizationPlanUser,
  ): Promise<LimitCheckResult> {
    return this.dependencies.seats.checkLimit({ organizationId, resource: limitType, user: by });
  }

  async checkAll(
    { organizationId }: Readonly<{ organizationId: string }>,
    by: OrganizationPlanUser,
  ): Promise<Record<LimitType, LimitCheckResult>> {
    const [members, membersLite] = await Promise.all([
      this.check({ organizationId, limitType: "members" }, by),
      this.check({ organizationId, limitType: "membersLite" }, by),
    ]);
    return { members, membersLite };
  }

  /** Re-checked before anyone is told, so a fabricated report raises nothing. */
  async reportBlocked(
    input: Readonly<{ organizationId: string; limitType: LimitType }>,
    by: OrganizationPlanUser,
  ): Promise<void> {
    const result = await this.check(input, by);
    if (result.allowed) return;

    void this.dependencies.notices
      ?.notifySeatLimitReached({
        organizationId: input.organizationId,
        limitType: result.limitType,
        current: result.current,
        max: result.max,
      })
      .catch((failure: unknown) => this.dependencies.signals.reportError(failure));
  }
}
