import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type {
  SendUsageLimitWarningInput,
  UsageLimitWarning,
} from "@langwatch/entitlement-contract";
import type { Logger } from "@langwatch/observability";
import { toDate } from "@langwatch/time";

import { findCrossedUsageThreshold } from "../rules/usage-warning-thresholds.rules.ts";
import type { EntitlementService } from "./entitlement.service.ts";
import {
  USAGE_UNKNOWN,
  type EntitlementUsagePeers,
  type UsageService,
} from "./usage-enforcement.service.ts";
import {
  type CountedUsageReading,
  UsageWarningSweepService,
} from "./usage-warning-sweep.service.ts";

/** The approaching-limit mail: entitlement decides the threshold and counts; billing sends. */
export interface UsageWarning {
  /** Reports nothing sent when the reading crossed no threshold, or the window still holds. */
  sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
  /** Main's daily check of every organization; Cloud only. */
  sweep(): Promise<void>;
}

/** The warning over billing's send: the threshold and the per-project counts are decided here. */
export class UsageWarningService implements UsageWarning {
  static create(input: {
    billing: Pick<BillingApi, "sendUsageWarning">;
    counter: UsageService;
    plans: Pick<EntitlementService, "getActivePlan">;
    peers: EntitlementUsagePeers;
    isSaas: boolean;
    logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
  }): UsageWarningService {
    const projectIds = (organizationId: string) =>
      input.peers.projects.listIdsByOrganization({ organizationId });
    return new UsageWarningService({
      billing: input.billing,
      counter: input.counter,
      projectIds,
      sweep: (send) =>
        UsageWarningSweepService.create({
          isSaas: input.isSaas,
          logger: input.logger,
          organizationIds: () => input.peers.organizations.findAllIds(),
          projectIds,
          countByProjects: (counted) => input.counter.getCurrentMonthCountByProjects(counted),
          activePlan: (organizationId) => input.plans.getActivePlan({ organizationId }),
          send,
        }),
    });
  }

  readonly #sweep: UsageWarningSweepService;
  readonly #billing: Pick<BillingApi, "sendUsageWarning">;
  readonly #counter: UsageService;
  readonly #projectIds: (organizationId: string) => Promise<string[]>;

  private constructor(input: {
    billing: Pick<BillingApi, "sendUsageWarning">;
    counter: UsageService;
    projectIds: (organizationId: string) => Promise<string[]>;
    sweep: (
      send: (input: CountedUsageReading) => Promise<UsageLimitWarning>,
    ) => UsageWarningSweepService;
  }) {
    this.#billing = input.billing;
    this.#counter = input.counter;
    this.#projectIds = input.projectIds;
    this.#sweep = input.sweep((reading) => this.#decide(reading));
  }

  /** A caller's reading: counted per project only once a threshold is crossed. */
  async sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
    if (findCrossedUsageThreshold(input) === undefined) return { sent: false };
    const { organizationId } = input;
    const projectCounts = await this.#counter.getCountByProjects({
      organizationId,
      projectIds: await this.#projectIds(organizationId),
    });
    if (projectCounts === USAGE_UNKNOWN) return { sent: false };
    return this.#decide({ ...input, projectCounts });
  }

  sweep(): Promise<void> {
    return this.#sweep.sweep();
  }

  async #decide(input: CountedUsageReading): Promise<UsageLimitWarning> {
    const crossedThreshold = findCrossedUsageThreshold(input);
    if (crossedThreshold === undefined) return { sent: false };
    const { sent, notificationId, sentAt } = await this.#billing.sendUsageWarning({
      ...input,
      crossedThreshold,
    });
    return {
      sent,
      ...(notificationId === undefined ? {} : { notificationId }),
      ...(sentAt === undefined ? {} : { sentAt: toDate(sentAt) }),
    };
  }
}
