import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import {
  type Plan,
  planScenarioRunCap,
  SCENARIO_RUNS_LIMIT_TYPE,
  type ScenarioRunsCountedEventData,
  type ScenarioRunUsage,
} from "@langwatch/entitlement-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { Temporal } from "@langwatch/time";

import type { BillableEventsMeterRepository } from "../repositories/billable-events-meter.repository.ts";
import {
  isRunRefused,
  scenarioRunMonthOf,
  scenarioRunUsageOf,
} from "../rules/scenario-run-cap.rules.ts";

const defaultLogger = createLogger("langwatch:entitlement:scenario-run-cap");

/** How long a month's count is reused at the door; accepted runs are added to it meanwhile. */
const RUN_COUNT_CACHE_TTL_MS = 30_000;

type ScenarioRunCapDependencies = Readonly<{
  meter: Pick<BillableEventsMeterRepository, "countEventType" | "findFirstEventAt">;
  plans: { getActivePlan(input: { organizationId: string }): Promise<Plan> };
  now: () => number;
  logger?: Pick<Logger, "warn">;
}>;

/**
 * The cloud Free scenario run cap: no cap for the grace after the organization's first
 * run, then a number of runs per UTC month. Runs are read from the billable events meter.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export class ScenarioRunCapService {
  readonly #firstRuns = new Map<string, number>();
  readonly #monthRuns = new Map<string, { month: string; runs: number; expiresAt: number }>();
  readonly #logger: Pick<Logger, "warn">;

  private constructor(private readonly deps: ScenarioRunCapDependencies) {
    this.#logger = deps.logger ?? defaultLogger;
  }

  static create(deps: ScenarioRunCapDependencies): ScenarioRunCapService {
    return new ScenarioRunCapService(deps);
  }

  /** @throws LimitExceededError (`scenarioRuns`) once the month's runs reach an applying cap. */
  async assertRunAllowed({ organizationId }: { organizationId: string }): Promise<void> {
    const plan = await this.deps.plans.getActivePlan({ organizationId });
    const cap = planScenarioRunCap({ plan });
    if (!cap.capped) return;

    const now = this.deps.now();
    let reading: { runs: number; firstRunAt: number | null };
    try {
      reading = await this.#read({ organizationId, now, cached: true });
    } catch (error) {
      this.#logger.warn(
        { error, organizationId, plan: plan.name },
        "scenario run usage is unavailable, allowing the run",
      );
      return;
    }
    if (isRunRefused({ ...reading, cap, now })) {
      throw new LimitExceededError(SCENARIO_RUNS_LIMIT_TYPE, reading.runs, cap.maxPerMonth);
    }
    // Run starts reach the meter asynchronously, so an accepted run is counted at once.
    this.#accept(organizationId);
    if (reading.firstRunAt === null) this.#firstRuns.set(organizationId, now);
  }

  /** The month's runs for the usage page; null on a plan with no run cap. */
  async usage({
    organizationId,
    plan,
  }: {
    organizationId: string;
    plan: Plan;
  }): Promise<ScenarioRunUsage | null> {
    const cap = planScenarioRunCap({ plan });
    if (!cap.capped) return null;
    const now = this.deps.now();
    try {
      const reading = await this.#read({ organizationId, now, cached: false });
      return scenarioRunUsageOf({ ...reading, cap, now });
    } catch (error) {
      this.#logger.warn({ error, organizationId }, "scenario run usage is unavailable");
      const firstRunAt = this.#firstRuns.get(organizationId) ?? null;
      return scenarioRunUsageOf({ runs: null, firstRunAt, cap, now });
    }
  }

  /** Whether the organization's plan caps scenario runs at all. */
  async isCapped({ organizationId }: { organizationId: string }): Promise<boolean> {
    const plan = await this.deps.plans.getActivePlan({ organizationId });
    return planScenarioRunCap({ plan }).capped;
  }

  /** Counts a capped organization's month for its fact event; null on a plan with no cap. */
  async count(input: {
    organizationId: string;
    month: string;
    occurredAt: number;
  }): Promise<ScenarioRunsCountedEventData | null> {
    const plan = await this.deps.plans.getActivePlan({ organizationId: input.organizationId });
    const cap = planScenarioRunCap({ plan });
    if (!cap.capped) return null;
    const window = scenarioRunMonthOf(
      Temporal.Instant.from(`${input.month}-01T00:00:00Z`).epochMilliseconds,
    );
    const [runs, firstRunAt] = await Promise.all([
      this.deps.meter.countEventType({
        organizationId: input.organizationId,
        eventType: SIMULATION_RUN_EVENT_TYPES.STARTED,
        startDate: window.startDate,
        endDate: window.endDate,
      }),
      this.deps.meter.findFirstEventAt({
        organizationId: input.organizationId,
        eventType: SIMULATION_RUN_EVENT_TYPES.STARTED,
      }),
    ]);
    return {
      ...input,
      runs,
      firstRunAt,
      cap: { maxPerMonth: cap.maxPerMonth, graceDays: cap.graceDays },
    };
  }

  async #read({
    organizationId,
    now,
    cached,
  }: {
    organizationId: string;
    now: number;
    cached: boolean;
  }): Promise<{ runs: number; firstRunAt: number | null }> {
    const { month, startDate, endDate } = scenarioRunMonthOf(now);
    const eventType = SIMULATION_RUN_EVENT_TYPES.STARTED;
    const known = this.#monthRuns.get(organizationId);
    const firstKnown = this.#firstRuns.get(organizationId);
    const isFresh = known !== undefined && known.month === month && known.expiresAt > now;
    if (cached && isFresh && firstKnown) {
      return { runs: known.runs, firstRunAt: firstKnown };
    }
    const [runs, firstRunAt] = await Promise.all([
      this.deps.meter.countEventType({ organizationId, eventType, startDate, endDate }),
      firstKnown !== undefined
        ? Promise.resolve(firstKnown)
        : this.deps.meter.findFirstEventAt({ organizationId, eventType }),
    ]);
    if (firstRunAt !== null) this.#firstRuns.set(organizationId, firstRunAt);
    const counted = known && known.month === month ? Math.max(runs, known.runs) : runs;
    this.#monthRuns.set(organizationId, {
      month,
      runs: counted,
      expiresAt: now + RUN_COUNT_CACHE_TTL_MS,
    });
    return { runs: counted, firstRunAt };
  }

  #accept(organizationId: string): void {
    const known = this.#monthRuns.get(organizationId);
    if (!known) return;
    this.#monthRuns.set(organizationId, { ...known, runs: known.runs + 1 });
  }
}
