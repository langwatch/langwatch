import type {
  AutomationPersistCapConfig,
  AutomationPersistCapCount,
  AutomationPersistCapDecision,
  AutomationPlan,
} from "@langwatch/automation-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import { ENTERPRISE_PLAN_TYPES, FREE_PLAN_TYPES } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { AutomationPersistCapRepository } from "../repositories/automation-persist-cap.repository.ts";
import { decidePersistCap } from "../rules/persist-cap.rules.ts";

const logger = createLogger("langwatch:automations:persist-cap");

const CAP_CACHE_TTL_MS = 10 * 60 * 1000;
const capCache = new Map<string, { value: number; expiresAt: number }>();

/**
 * Plan type is provider-owned string data, so unknown paid plans use the paid
 * cap. The tier sets live in `@langwatch/plans`, the one table every tier
 * test reads.
 */
export type PersistCapConfig = AutomationPersistCapConfig;

export interface PersistCapDependencies {
  projects: ProjectApi;
  planProvider: EntitlementApi;
  config: PersistCapConfig;
  /** Where today's slots are counted. */
  slots: AutomationPersistCapRepository;
}

export type ConsumePersistCapSlotInput = {
  projectId: string;
  triggerId: string;
  now: Instant;
  cap: number;
  /**
   * Stable identity for THIS logical dispatch — the (trigger, trace) pair. An
   * outbox retry of the same dispatch presents the same key and must not
   * consume a second slot.
   */
  dedupKey: string;
};

export type ReadPersistCapCountsInput = {
  projectId: string;
  triggerIds: readonly string[];
  now: Instant;
  cap: number;
};

/** One process-owned service for plan resolution and idempotent cap claims. */
export class AutomationPersistCapService {
  private constructor(private readonly dependencies: PersistCapDependencies) {}

  static create(input: PersistCapDependencies): AutomationPersistCapService {
    return new AutomationPersistCapService(input);
  }

  /** Test-only: forget every cached plan ceiling. */
  static resetPlanCache(): void {
    capCache.clear();
  }

  /** Resolve a contract override or plan-tier cap. Failed lookups use, but do not cache, paid. */
  async resolvePersistDailyCap(projectId: string): Promise<number> {
    const cached = capCache.get(projectId);
    if (cached && cached.expiresAt > nowInstant().epochMilliseconds) {
      return cached.value;
    }

    if (cached) {
      capCache.delete(projectId);
    }

    try {
      const organizationId = await this.dependencies.projects.getOrganizationId(projectId);

      const cap = AutomationPersistCapService.capForPlan(
        await this.dependencies.planProvider.getActivePlan({ organizationId }),
        this.dependencies.config,
      );
      capCache.set(projectId, {
        value: cap,
        expiresAt: nowInstant().epochMilliseconds + CAP_CACHE_TTL_MS,
      });

      return cap;
    } catch (error) {
      logger.warn(
        {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not resolve the plan for this project's automation ceiling, " +
          "using the paid-tier ceiling for this dispatch",
      );

      return this.dependencies.config.paid;
    }
  }

  /**
   * Claim before incrementing so outbox retries are idempotent. Continue counting
   * past the cap because the excess is the customer-visible skipped total.
   */
  async consumePersistCapSlot(
    input: ConsumePersistCapSlotInput,
  ): Promise<AutomationPersistCapDecision> {
    const slot = await this.dependencies.slots.consumeSlot(input);
    return decidePersistCap({ count: slot.count, cap: input.cap });
  }

  /**
   * How many confirmed matches each of these triggers dropped today, for the
   * automations list. Read-only: it never consumes a slot.
   */
  async readPersistCapCounts(
    input: ReadPersistCapCountsInput,
  ): Promise<Record<string, AutomationPersistCapCount>> {
    const counts = await this.dependencies.slots.findCounts(input);
    return Object.fromEntries(
      counts.map(({ triggerId, count }) => [
        triggerId,
        { count, skipped: decidePersistCap({ count, cap: input.cap }).skipped },
      ]),
    );
  }

  /** A contract allowance wins; otherwise the plan's tier decides. */
  private static capForPlan(plan: AutomationPlan, config: PersistCapConfig): number {
    if (plan.maxTriggerPersistDispatchesPerDay !== undefined) {
      return plan.maxTriggerPersistDispatchesPerDay;
    }

    if (plan.automationDailyDispatchCeiling !== undefined) {
      return plan.automationDailyDispatchCeiling;
    }

    if (ENTERPRISE_PLAN_TYPES.has(plan.type)) {
      return config.enterprise;
    }

    if (FREE_PLAN_TYPES.has(plan.type) || plan.free) {
      return config.free;
    }

    return config.paid;
  }
}

export type PersistCapDecision = AutomationPersistCapDecision;
