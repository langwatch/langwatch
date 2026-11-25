// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import { fireGuidedOnboardingBackfill } from "../rules/nurturing-guided-onboarding-service.rules.ts";
import { latestCurrentMemberships } from "../rules/nurturing-organization-member.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/** Once per person and organization, so this outlives any realistic replay of a login. */
const BACKFILL_WINDOW_SECONDS = 365 * 24 * 60 * 60;

type GuidedOnboardingBackfillDependencies = Readonly<{
  claims: NurturingClaimRepository;
  customerIo: NurturingService;
  members: NurturingOrganizationMemberRepository;
  organizations: OrganizationApi;
}>;

/**
 * The first-login backfill: a person who picked paths before the live hooks reached Customer.io
 * gets their latest organization's guided traits on their next session, once. The claim is taken
 * only for a state with picks and given back when the send fails, so a later login sends it. A
 * failed read only logs: the login's own delivery never fails for it.
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
export class NurturingGuidedOnboardingBackfillService {
  static create(
    dependencies: GuidedOnboardingBackfillDependencies,
  ): NurturingGuidedOnboardingBackfillService {
    return new NurturingGuidedOnboardingBackfillService(dependencies);
  }

  private constructor(private readonly dependencies: GuidedOnboardingBackfillDependencies) {}

  async deliver(signal: NurturingSignal): Promise<void> {
    if (signal.kind !== "session_started" || !signal.hasOrganization) return;
    try {
      await this.backfill(signal.userId);
    } catch (error) {
      nurturingLogger.warn({ error }, "the guided onboarding backfill could not be read");
    }
  }

  private async backfill(userId: string): Promise<void> {
    const { claims, customerIo, members, organizations } = this.dependencies;
    const memberships = await members.findMembershipsOfUsers({ userIds: [userId] });
    const [latest] = latestCurrentMemberships(memberships);
    if (!latest) return;
    const { organizationId } = latest;

    const { state, variant } = await organizations.readGuidedOnboardingState({ organizationId });
    const calls = fireGuidedOnboardingBackfill({ userId, organizationId, variant, state });
    if (calls.length === 0) return;

    const claimKey = `nurturing:guided_onboarding_backfill:${userId}:${organizationId}`;
    if (!(await claims.claim(claimKey, BACKFILL_WINDOW_SECONDS))) return;
    try {
      await customerIo.batchOrThrow(calls);
    } catch (error) {
      const released = await NurturingClaimReleaseService.create(claims).releasedAll([claimKey]);
      nurturingLogger.warn(
        { error, released },
        "the guided onboarding backfill could not be delivered; its claim is given back",
      );
    }
  }
}
