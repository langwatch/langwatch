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

/** Every run start counts, from the platform or from code: the cap is on how much an org runs. */
const RUN_STARTS = { eventType: SIMULATION_RUN_EVENT_TYPES.STARTED } as const;

const defaultLogger = createLogger("langwatch:entitlement:scenario-run-cap");

/** How long a month's meter count is reused at the door; pending runs are added to it. */
const RUN_COUNT_CACHE_TTL_MS = 30_000;
/** A keyed run the meter has not seen by then never started, so it frees its slot. */
const PENDING_RUN_TTL_MS = 10 * 60_000;

type ScenarioRunCapDependencies = Readonly<{
  meter: Pick<
    BillableEventsMeterRepository,
    "countEventType" | "findFirstEventAt" | "hasDeduplicationKey" | "findDeduplicationKeys"
  >;
  plans: { getActivePlan(input: { organizationId: string }): Promise<Plan> };
  now: () => number;
  logger?: Pick<Logger, "error">;
}>;

/**
 * The cloud Free scenario run cap: no cap for the grace after the organization's first
 * run, then a number of runs per UTC month. Runs are read from the billable events meter.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export class ScenarioRunCapService {
  readonly #firstRuns = new Map<string, number>();
  readonly #monthRuns = new Map<string, { month: string; meterRuns: number; expiresAt: number }>();
  /** Accepted runs the meter may not hold yet, by start key (or a local id), with when accepted. */
  readonly #pendingRuns = new Map<string, { month: string; acceptedAt: Map<string, number> }>();
  #localRunIds = 0;
  readonly #logger: Pick<Logger, "error">;

  private constructor(private readonly deps: ScenarioRunCapDependencies) {
    this.#logger = deps.logger ?? defaultLogger;
  }

  static create(deps: ScenarioRunCapDependencies): ScenarioRunCapService {
    return new ScenarioRunCapService(deps);
  }

  /**
   * Counts the run unless `shouldCountRun` is false. A run already admitted or metered under
   * its `runKey` passes without counting again, so a retried start is counted once.
   * Best-effort across instances.
   * @throws LimitExceededError (`scenarioRuns`) once the month's runs reach an applying cap.
   */
  async assertRunAllowed({
    organizationId,
    shouldCountRun = true,
    runKey,
  }: {
    organizationId: string;
    shouldCountRun?: boolean | undefined;
    runKey?: { projectId: string; deduplicationKey: string } | undefined;
  }): Promise<void> {
    const plan = await this.deps.plans.getActivePlan({ organizationId });
    const cap = planScenarioRunCap({ plan });
    if (!cap.capped) return;

    const now = this.deps.now();
    if (runKey && (await this.#isAdmitted({ organizationId, runKey, now }))) return;
    let reading: { runs: number; firstRunAt: number | null };
    try {
      reading = await this.#read({ organizationId, now, cached: true });
    } catch (error) {
      this.#logger.error(
        { error, organizationId, plan: plan.name },
        "scenario run usage is unavailable, allowing the run",
      );
      return;
    }
    if (isRunRefused({ ...reading, cap, now })) {
      throw new LimitExceededError(SCENARIO_RUNS_LIMIT_TYPE, reading.runs, cap.maxPerMonth);
    }
    if (!shouldCountRun) return;
    // Run starts reach the meter asynchronously, so an accepted run is counted at once.
    this.#pending({ organizationId, now }).set(
      runKey?.deduplicationKey ?? `local:${++this.#localRunIds}`,
      now,
    );
    if (reading.firstRunAt === null) this.#firstRuns.set(organizationId, now);
  }

  /** The month's runs for the usage page; undefined on a plan with no run cap. */
  async computeUsage({
    organizationId,
    plan,
  }: {
    organizationId: string;
    plan: Plan;
  }): Promise<ScenarioRunUsage | undefined> {
    const cap = planScenarioRunCap({ plan });
    if (!cap.capped) return undefined;
    const now = this.deps.now();
    try {
      const reading = await this.#read({ organizationId, now, cached: false });
      return scenarioRunUsageOf({ ...reading, cap, now });
    } catch (error) {
      this.#logger.error({ error, organizationId }, "scenario run usage is unavailable");
      const firstRunAt = this.#firstRuns.get(organizationId) ?? null;
      return scenarioRunUsageOf({ runs: null, firstRunAt, cap, now });
    }
  }

  /** Whether the organization's plan caps scenario runs at all. */
  async isCapped({ organizationId }: { organizationId: string }): Promise<boolean> {
    const plan = await this.deps.plans.getActivePlan({ organizationId });
    return planScenarioRunCap({ plan }).capped;
  }

  /** Counts a capped organization's month for its fact event; undefined on a plan with no cap. */
  async computeMonthCount(input: {
    organizationId: string;
    month: string;
    occurredAt: number;
  }): Promise<ScenarioRunsCountedEventData | undefined> {
    const plan = await this.deps.plans.getActivePlan({ organizationId: input.organizationId });
    const cap = planScenarioRunCap({ plan });
    if (!cap.capped) return undefined;
    const window = scenarioRunMonthOf(
      Temporal.Instant.from(`${input.month}-01T00:00:00Z`).epochMilliseconds,
    );
    const [runs, firstRunAt] = await Promise.all([
      this.deps.meter.countEventType({
        organizationId: input.organizationId,
        ...RUN_STARTS,
        startDate: window.startDate,
        endDate: window.endDate,
      }),
      this.deps.meter.findFirstEventAt({ organizationId: input.organizationId, ...RUN_STARTS }),
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
    const known = this.#monthRuns.get(organizationId);
    const firstKnown = this.#firstRuns.get(organizationId);
    const isFresh = known !== undefined && known.month === month && known.expiresAt > now;
    const pending = this.#pending({ organizationId, now });
    if (cached && isFresh && firstKnown) {
      return { runs: known.meterRuns + pending.size, firstRunAt: firstKnown };
    }
    const [meterRuns, firstRunAt] = await Promise.all([
      this.deps.meter.countEventType({ organizationId, ...RUN_STARTS, startDate, endDate }),
      firstKnown !== undefined
        ? Promise.resolve(firstKnown)
        : this.deps.meter.findFirstEventAt({ organizationId, ...RUN_STARTS }),
    ]);
    if (firstRunAt !== null) this.#firstRuns.set(organizationId, firstRunAt);
    await this.#settlePending({ organizationId, pending, now });
    this.#monthRuns.set(organizationId, {
      month,
      meterRuns,
      expiresAt: now + RUN_COUNT_CACHE_TTL_MS,
    });
    return { runs: meterRuns + pending.size, firstRunAt };
  }

  /** Drops pending runs the meter now holds, and those too old to still be waiting on it. */
  async #settlePending({
    organizationId,
    pending,
    now,
  }: {
    organizationId: string;
    pending: Map<string, number>;
    now: number;
  }): Promise<void> {
    const keys = [...pending.keys()].filter((key) => !key.startsWith("local:"));
    if (keys.length > 0) {
      try {
        const metered = await this.deps.meter.findDeduplicationKeys({
          organizationId,
          deduplicationKeys: keys,
        });
        for (const key of metered) pending.delete(key);
      } catch (error) {
        this.#logger.error({ error, organizationId }, "could not settle pending scenario runs");
      }
    }
    for (const [key, acceptedAt] of pending) {
      const ttl = key.startsWith("local:") ? RUN_COUNT_CACHE_TTL_MS : PENDING_RUN_TTL_MS;
      if (now - acceptedAt >= ttl) pending.delete(key);
    }
  }

  async #isAdmitted({
    organizationId,
    runKey,
    now,
  }: {
    organizationId: string;
    runKey: { projectId: string; deduplicationKey: string };
    now: number;
  }): Promise<boolean> {
    // A pending run past its window is no longer admitted: its retry asks the cap again.
    const acceptedAt = this.#pending({ organizationId, now }).get(runKey.deduplicationKey);
    if (acceptedAt !== undefined && now - acceptedAt < PENDING_RUN_TTL_MS) return true;
    try {
      return await this.deps.meter.hasDeduplicationKey({ organizationId, ...runKey });
    } catch (error) {
      this.#logger.error({ error, organizationId }, "could not look up the run start's meter key");
      return false;
    }
  }

  #pending({ organizationId, now }: { organizationId: string; now: number }): Map<string, number> {
    const { month } = scenarioRunMonthOf(now);
    const known = this.#pendingRuns.get(organizationId);
    if (known && known.month === month) return known.acceptedAt;
    const acceptedAt = new Map<string, number>();
    this.#pendingRuns.set(organizationId, { month, acceptedAt });
    return acceptedAt;
  }
}
