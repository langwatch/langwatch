import type {
  SendUsageLimitWarningInput,
  UsageLimitWarning,
  UsageThresholdCrossedEventData,
} from "@langwatch/entitlement-contract";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { findCrossedUsageThreshold } from "../rules/usage-warning-thresholds.rules.ts";
import type { EntitlementService } from "./entitlement.service.ts";
import { UsageCountingService } from "./usage-counting.service.ts";
import {
  USAGE_UNKNOWN,
  type UsageService,
  type UsageTenancy,
} from "./usage-enforcement.service.ts";
import {
  type CountedUsageReading,
  UsageWarningSweepService,
} from "./usage-warning-sweep.service.ts";

/** The approaching-limit warning: entitlement records the crossed threshold; billing mails it. */
export interface UsageWarning {
  /** Reports sent whenever a threshold is crossed and recorded; nothing below them all. */
  sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
  /** Main's daily check of every organization; Cloud only. */
  sweep(): Promise<void>;
}

/** Decides the threshold and the per-project counts, and records them as entitlement's fact. */
export class UsageWarningService implements UsageWarning {
  static create(input: {
    record: (data: UsageThresholdCrossedEventData) => Promise<void>;
    counter: UsageService;
    plans: Pick<EntitlementService, "getActivePlan">;
    tenancy: UsageTenancy;
    isSaas: boolean;
    logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
  }): UsageWarningService {
    const projectIds = (organizationId: string) => input.tenancy.findProjectIds({ organizationId });
    return new UsageWarningService({
      record: input.record,
      counter: input.counter,
      projectIds,
      sweep: (send) =>
        UsageWarningSweepService.create({
          isSaas: input.isSaas,
          logger: input.logger,
          organizationIds: () => input.tenancy.findMeteredOrganizationIds(),
          projectIds,
          countByProjects: (counted) => input.counter.getCurrentMonthCountByProjects(counted),
          activePlan: (organizationId) => input.plans.getActivePlan({ organizationId }),
          send,
        }),
    });
  }

  readonly #sweep: UsageWarningSweepService;
  readonly #record: (data: UsageThresholdCrossedEventData) => Promise<void>;
  readonly #counter: UsageService;
  readonly #projectIds: (organizationId: string) => Promise<string[]>;

  private constructor(input: {
    record: (data: UsageThresholdCrossedEventData) => Promise<void>;
    counter: UsageService;
    projectIds: (organizationId: string) => Promise<string[]>;
    sweep: (
      send: (input: CountedUsageReading) => Promise<UsageLimitWarning>,
    ) => UsageWarningSweepService;
  }) {
    this.#record = input.record;
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
    const occurredAt = nowInstant().epochMilliseconds;
    // Ruling M5-EVENT: billing's mail is asynchronous, so the answer is the recording alone.
    await this.#record({
      ...input,
      crossedThreshold,
      month: UsageCountingService.monthOf(occurredAt),
      occurredAt,
    });
    return { sent: true };
  }
}
