// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import { fireGuidedOnboardingBackfill } from "../rules/nurturing-guided-onboarding-service.rules.ts";
import { latestCurrentMemberships } from "../rules/nurturing-organization-member.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/** Once per person, so this outlives any realistic replay of a login. */
const BACKFILL_WINDOW_SECONDS = 365 * 24 * 60 * 60;

/**
 * How long an attempt holds the claim before its send has succeeded. Short, so an attempt whose
 * send and release both failed blocks the backfill for an hour, not for the year.
 */
const ATTEMPT_WINDOW_SECONDS = 60 * 60;

type GuidedOnboardingBackfillDependencies = Readonly<{
  claims: NurturingClaimRepository;
  customerIo: NurturingService;
  members: NurturingOrganizationMemberRepository;
  organizations: OrganizationApi;
}>;

/**
 * The first-login backfill: a person who picked paths before the live hooks reached Customer.io
 * gets their latest organization's guided traits on their next session, once. The claim comes
 * first, so a settled person costs one claim and no read. An attempt holds it for an hour; a sent
 * backfill holds it for the year, and an empty or failed one gives it back, or lets it lapse.
 * A failure only logs: the login's own delivery never fails for it.
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
      nurturingLogger.warn({ error }, "the guided onboarding backfill could not be completed");
    }
  }

  private async backfill(userId: string): Promise<void> {
    const { claims, customerIo } = this.dependencies;
    const claimKey = `nurturing:guided_onboarding_backfill:${userId}`;
    if (!(await claims.claim(claimKey, ATTEMPT_WINDOW_SECONDS))) return;
    const release = () => NurturingClaimReleaseService.create(claims).releasedAll([claimKey]);
    let calls: CioBatchCall[];
    try {
      // Read only after the claim so another member's newer pick is not reverted by this send;
      // what the few milliseconds left still miss, the next live path event overwrites.
      calls = await this.callsFor(userId);
      if (calls.length > 0) await customerIo.batchOrThrow(calls);
    } catch (error) {
      nurturingLogger.warn(
        { error, released: await release() },
        "the guided onboarding backfill could not be delivered; its claim is given back or lapses",
      );
      return;
    }
    if (calls.length === 0) {
      await release();
      return;
    }
    // A claim's window is fixed when it is taken, so the attempt's is swapped for the year's.
    await claims.release(claimKey);
    await claims.claim(claimKey, BACKFILL_WINDOW_SECONDS);
  }

  /** The backfill of the person's latest organization; none for a person in no organization. */
  private async callsFor(userId: string): Promise<CioBatchCall[]> {
    const { members, organizations } = this.dependencies;
    const memberships = await members.findMembershipsOfUsers({ userIds: [userId] });
    const [latest] = latestCurrentMemberships(memberships);
    if (!latest) return [];
    const { organizationId } = latest;
    const { state, variant } = await organizations.readGuidedOnboardingState({ organizationId });
    return fireGuidedOnboardingBackfill({ userId, organizationId, variant, state });
  }
}
