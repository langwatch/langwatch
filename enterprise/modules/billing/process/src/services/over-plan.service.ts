// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Over plan (specs/billing/over-plan-trace-withholding.feature): a downgrade to Free while the
 * organization holds more members than Free allows marks it; traces it records from the mark on
 * are withheld while it is on Free and still over the member limit. Only a recorded downgrade
 * marks, so an organization over its member count without one is never affected.
 */
import { getFreePlanLimits } from "@langwatch/enterprise-billing-contract";
import type { OverPlan } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import type { OverPlanMark, OverPlanRepository } from "../repositories/over-plan.repository.ts";
import type { BillingLifecycleAnnouncerService } from "./billing-lifecycle-announcer.service.ts";

const logger = createLogger("langwatch:billing:over-plan");

export type OverPlanDowngradeReason = "cancelled" | "payment_recovery";

export type OverPlanSweepOutcome = { ended: number; failed: number };

export type OverPlanState = { kind: "over_plan"; overPlan: OverPlan } | { kind: "within_plan" };

type OverPlanOptions = {
  marks: OverPlanRepository;
  organizations: Pick<BillingAccountFactsRepository, "findActiveMemberIds">;
  /** Whether the organization answers the Free plan now; the plan without the over-plan state. */
  isOnFree: (organizationId: string) => Promise<boolean>;
  /** Records the fact; absent where a suite composes no lifecycle pipeline. */
  facts?: Pick<BillingLifecycleAnnouncerService, "overPlanChanged">;
  now?: () => Instant;
};

export class OverPlanService {
  static create(options: OverPlanOptions): OverPlanService {
    return new OverPlanService(options);
  }

  private readonly now: () => Instant;

  private constructor(private readonly options: OverPlanOptions) {
    this.now = options.now ?? nowInstant;
  }

  /** The organization fell to Free at `since`; marks it only when it holds too many members. */
  async downgraded({
    organizationId,
    subscriptionId,
    since,
    reason,
  }: {
    organizationId: string;
    subscriptionId: string;
    since: Instant;
    reason: OverPlanDowngradeReason;
  }): Promise<void> {
    // A replaced subscription's end leaves the organization on its new plan, not on Free.
    if (!(await this.options.isOnFree(organizationId))) return;
    const { members, maxMembers } = await this.membersOf(organizationId);
    if (members <= maxMembers) return;
    await this.options.marks.mark({ subscriptionId, since });
    logger.info({ organizationId, reason, members, maxMembers }, "Organization is over its plan");
    await this.options.facts?.overPlanChanged({
      organizationId,
      subscriptionId,
      state: "started",
      reason,
      since,
      members,
      maxMembers,
    });
  }

  /** The state a Free plan carries now; within plan once no mark is open or the members fit. */
  async getState({ organizationId }: { organizationId: string }): Promise<OverPlanState> {
    const [newest] = await this.options.marks.findOpenForOrganization(organizationId);
    if (!newest) return { kind: "within_plan" };
    const { members, maxMembers } = await this.membersOf(organizationId);
    if (members <= maxMembers) return { kind: "within_plan" };
    return {
      kind: "over_plan",
      overPlan: { sinceMs: newest.since.epochMilliseconds, members, maxMembers },
    };
  }

  /** Ends each open mark whose organization is paid again or fits Free, recording the end. */
  async sweep(): Promise<OverPlanSweepOutcome> {
    const outcome: OverPlanSweepOutcome = { ended: 0, failed: 0 };
    let marks: OverPlanMark[];
    try {
      marks = await this.options.marks.findOpen();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Over-plan sweep could not read the open marks; the next sweep retries",
      );
      return { ended: 0, failed: 1 };
    }
    for (const mark of marks) {
      try {
        if (await this.endIfWithinPlan(mark)) outcome.ended++;
      } catch (error) {
        outcome.failed++;
        logger.warn(
          {
            organizationId: mark.organizationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Over-plan sweep could not check a mark; the next sweep retries it",
        );
      }
    }
    return outcome;
  }

  private async endIfWithinPlan(mark: OverPlanMark): Promise<boolean> {
    const { members, maxMembers } = await this.membersOf(mark.organizationId);
    const onFree = await this.options.isOnFree(mark.organizationId);
    if (onFree && members > maxMembers) return false;
    const ended = await this.options.marks.end({
      subscriptionId: mark.subscriptionId,
      endedAt: this.now(),
    });
    if (!ended) return false;
    await this.options.facts?.overPlanChanged({
      organizationId: mark.organizationId,
      subscriptionId: mark.subscriptionId,
      state: "ended",
      reason: "within_plan",
      since: mark.since,
      members,
      maxMembers,
    });
    return true;
  }

  private async membersOf(
    organizationId: string,
  ): Promise<{ members: number; maxMembers: number }> {
    const memberIds = await this.options.organizations.findActiveMemberIds(organizationId);
    return { members: memberIds.length, maxMembers: getFreePlanLimits().maxMembers };
  }
}
