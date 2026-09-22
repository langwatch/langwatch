// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The surface the drift check's integration suites are written against.
 *
 * `createWatchHarness` is a FACTORY, called once at the top of each suite, and
 * it registers that suite's own `beforeAll` / `beforeEach` / `afterAll`. It
 * composes rather than implements: the runtime box and everything that moves
 * it live in `costRollupWatch.integration.runtime`, and the three groupings
 * below are the vocabulary a scenario reads in — putting charges in, reading
 * back what the process did, and what the day's summary holds.
 *
 * Nothing mutable lives at module scope. The box is created per call, so two
 * suites sharing this module through the datastore lane's module registry
 * share no state.
 *
 * @see specs/governance/cost-rollup-watch.feature
 */
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { prisma } from "~/server/db";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager";

import type { CostRollupComparison } from "../../services/costRollupComparator.service";
import {
  buildDefinition,
  type ChargeOverrides,
  type CompareParams,
  compareForReal,
  deliver,
  drainPasses,
  instanceOf,
  makeCharge,
  outboxKey,
  refFor,
  registerLifecycle,
  runDueCheck,
  sweepDueChecks,
  type WatchRuntime,
} from "./costRollupWatch.integration.runtime";
import * as summary from "./costRollupWatch.summary.fixtures";

/** Driving the process: putting charges in and making checks run. */
function driving(runtime: WatchRuntime) {
  return {
    definition: () => buildDefinition(runtime.comparator),
    store: runtime.store,
    charge: (overrides: ChargeOverrides = {}) =>
      makeCharge({
        ...overrides,
        tenantId: overrides.tenantId ?? runtime.tenant,
      }),
    record: (
      event: PulledUsageProcessingEvent,
      { now = runtime.clock }: { now?: number } = {},
    ) => deliver(runtime, event, now),
    refFor: (tenantId = runtime.tenant) => refFor(runtime, tenantId),
    instanceOf: (tenantId = runtime.tenant) => instanceOf(runtime, tenantId),
    runDueCheck: (tenantId = runtime.tenant) => runDueCheck(runtime, tenantId),
    /**
     * Answers one wake exactly as it was scheduled — the hand-aimed path, for
     * the tests that need to hold a wake at a revision and deliver it late.
     */
    handleWake: (wake: {
      ref: ReturnType<typeof refFor>;
      revision: number;
      wakeAt: number;
    }) => runtime.service.handleWake({ wake, now: runtime.clock }),
    sweepDueChecks: () => sweepDueChecks(runtime),
    /** Drains the outbox at the present clock, for intents that are due now. */
    drainOutbox: ({ passes = 3 }: { passes?: number } = {}) =>
      drainPasses(runtime, { passes, stepMs: 1_000 }),
    /**
     * Drains far enough apart that each retry's backoff has elapsed. The ladder
     * tops out at eight minutes, so ten minutes a pass never leaves a due
     * message behind and mistakes a wait for a refusal.
     */
    drainThroughRetries: ({ passes }: { passes: number }) =>
      drainPasses(runtime, { passes, stepMs: 600_000 }),
  };
}

/** Reading back what the process did, and choosing what the check answers. */
function observing(runtime: WatchRuntime) {
  return {
    /** The comparisons asked for on this organization, in the order they ran. */
    daysComparedFor: (tenantId = runtime.tenant): string[] =>
      runtime.compareDayCalls
        .filter((call) => call.tenantId === tenantId)
        .map((call) => call.day),
    comparisonsWithSource: (costSource: string): CompareParams[] =>
      runtime.compareDayCalls.filter((call) => call.costSource === costSource),
    messagesFor: (tenantId = runtime.tenant) =>
      runtime.store.findMessagesByRef({ ref: refFor(runtime, tenantId) }),
    outboxKey: (key: string, tenantId = runtime.tenant) =>
      outboxKey(runtime, { key, tenantId }),
    compareForReal: (params: CompareParams) => compareForReal(runtime, params),
    /** The comparison the retry ladder is measured against: it never succeeds. */
    compareAndFail: async (): Promise<never> => {
      throw new Error("comparison unavailable");
    },
    /** Forgets the comparisons asked for so far, keeping the instance as it is. */
    forgetComparisons: () => {
      runtime.compareDayCalls = [];
    },
    /** Swaps what the intent handler does on its next attempt. */
    compareWith: (
      impl: (params: CompareParams) => Promise<CostRollupComparison>,
    ) => {
      runtime.compareDayImpl = impl;
    },
  };
}

/** The ClickHouse side: what the day holds, and what the summary says it holds. */
function summarizing(runtime: WatchRuntime) {
  return {
    appendObserved: (params: {
      costNanoMinor: number;
      occurredAtMs?: number;
    }) =>
      summary.appendObserved({
        ch: runtime.ch,
        tenantId: runtime.tenant,
        ...params,
      }),
    writeSummary: (params: {
      amountNanoMinor: number;
      occurredAtMs?: number;
    }) =>
      summary.writeSummary({
        repo: runtime.repo,
        tenantId: runtime.tenant,
        ...params,
      }),
    summarizedAmountsFor: (day: string) =>
      summary.summarizedAmountsFor({
        repo: runtime.repo,
        tenantId: runtime.tenant,
        day,
      }),
    eventLogCount: () =>
      summary.eventLogCount({ ch: runtime.ch, tenantId: runtime.tenant }),
    mismatchCount: () => summary.mismatchCount(),
    wakeLag: () => summary.wakeLag(),
  };
}

export function createWatchHarness({ tenantPrefix }: { tenantPrefix: string }) {
  const runtime = {
    prefix: `${tenantPrefix}-${nanoid(8)}`,
    store: new PrismaProcessStore(prisma),
    testLogger: createLogger("test:cost-rollup-watch-integration"),
    tenantSeq: 0,
    compareDayCalls: [] as CompareParams[],
    comparisons: [] as CostRollupComparison[],
  } as unknown as WatchRuntime;

  // Recorded out here rather than inside the definition so the record outlives
  // the per-test rebuild: what a test asks is "which comparisons were asked
  // for", and the implementation behind them is swapped freely.
  runtime.comparator = {
    compareDay: async (params) => {
      runtime.compareDayCalls.push(params);
      return await runtime.compareDayImpl(params);
    },
  };

  registerLifecycle(runtime);

  return {
    ...driving(runtime),
    ...observing(runtime),
    ...summarizing(runtime),
    get tenant() {
      return runtime.tenant;
    },
    get comparisons() {
      return runtime.comparisons;
    },
    get clock() {
      return runtime.clock;
    },
    set clock(value: number) {
      runtime.clock = value;
    },
  };
}
