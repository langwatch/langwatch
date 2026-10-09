// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The substrate the drift check's integration suites run on, and the moving
 * parts that drive it: Postgres holds the instance, the inbox and the outbox,
 * and ClickHouse holds the summary the comparison reads.
 *
 * Everything here is a plain function of a `WatchRuntime`, which is what keeps
 * it at module scope without keeping any STATE there. The check's suites run
 * in the datastore lane with a shared module registry, so a module-level `let`
 * would be one variable shared by every file that imported it; the runtime box
 * is created per factory call instead, in `costRollupWatch.integration.harness`.
 *
 * Isolation is by tenant, the way the sibling process-manager suites do it:
 * the process name is the one that ships, and each suite passes its OWN
 * `tenantPrefix`, so one file's rows can never be confused with another's —
 * not another run's, and not another suite's running beside it. Assertions are
 * scoped to those ids for the same reason: the lane shares one Postgres, and a
 * system-wide sweep legitimately sees whatever else is in it.
 *
 * @see specs/governance/cost-rollup-watch.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { GOVERNANCE_COST_SOURCE } from "@ee/governance/projections/governanceCostRollup.constants";
import type { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type { ProcessManagerConfig } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  OutboxDispatcherService,
  type PrismaProcessStore,
  type ProcessDefinition,
  type ProcessEventEnvelope,
  ProcessManagerService,
  ProcessWakeWorker,
} from "~/server/event-sourcing/process-manager";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import {
  type CostRollupComparatorDayComparer,
  CostRollupComparatorService,
  type CostRollupComparison,
} from "../../services/costRollupComparator.service";
import { GovernanceCostRollupClickHouseRepository } from "../../services/governanceCostRollup.clickhouse.repository";
import {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  type CostRollupWatchState,
  costRollupWatchPM,
} from "../costRollupWatch.process";
import * as summary from "./costRollupWatch.summary.fixtures";

const { NOW } = summary;

export type CompareParams = {
  tenantId: string;
  day: string;
  costSource: string;
};
type WatchConfig = ProcessManagerConfig<any, any, PulledUsageProcessingEvent>;

/** What a test may vary about one charge. The tenant defaults to the suite's. */
export interface ChargeOverrides {
  tenantId?: string;
  occurredAtMs?: number;
  eventType?: string;
  eventId?: string;
  aggregateId?: string;
}

/**
 * Everything the suite's hooks build, held in one object so the helpers can be
 * plain functions instead of closures over a pile of `let`s. Its identity is
 * stable for the life of the factory — fields are replaced per test, the box
 * is not — which is what lets the returned facade read the live runtime.
 */
export interface WatchRuntime {
  /** Fixed for the life of the factory. */
  prefix: string;
  store: PrismaProcessStore;
  testLogger: ReturnType<typeof createLogger>;
  comparator: CostRollupComparatorDayComparer;
  /** Built once, in `beforeAll`. */
  ch: ClickHouseClient;
  repo: GovernanceCostRollupClickHouseRepository;
  realComparator: CostRollupComparatorService;
  /** Rebuilt per test. */
  tenantSeq: number;
  tenant: string;
  clock: number;
  /**
   * What the process's intent handler is wired to. The implementation is
   * swapped per test — the real comparator where the assertion is about the
   * summary, one that always throws where it is about the retry ladder — while
   * the recorder around it stays the same, so "which comparisons were asked
   * for" reads the same way in every scenario.
   */
  compareDayImpl: (params: CompareParams) => Promise<CostRollupComparison>;
  compareDayCalls: CompareParams[];
  comparisons: CostRollupComparison[];
  config: WatchConfig;
  service: ProcessManagerService<CostRollupWatchState>;
  dispatcher: OutboxDispatcherService;
}

export function buildDefinition(comparator: CostRollupComparatorDayComparer) {
  return buildProcessManager<PulledUsageProcessingEvent>({
    name: COST_ROLLUP_WATCH_PROCESS_NAME,
    applier: costRollupWatchPM({ comparator }),
  });
}

/** One charge, as the log holds it: the tenant, the item stream, the moment. */
export function makeCharge({
  tenantId,
  occurredAtMs = NOW,
  eventType = PULLED_USAGE_EVENT_TYPES.OBSERVED,
  eventId = `evt-${nanoid(10)}`,
  aggregateId = `item-${nanoid(6)}`,
}: ChargeOverrides & { tenantId: string }): PulledUsageProcessingEvent {
  return {
    id: eventId,
    type: eventType,
    tenantId,
    aggregateId,
    occurredAt: occurredAtMs,
    data: { restatementKey: aggregateId, occurredAtMs },
  } as unknown as PulledUsageProcessingEvent;
}

export function refFor(runtime: WatchRuntime, tenantId: string) {
  return {
    processName: COST_ROLLUP_WATCH_PROCESS_NAME,
    projectId: tenantId,
    processKey: runtime.config.keyBy!(makeCharge({ tenantId })),
  };
}

/** Delivers one charge exactly as the generated subscriber would. */
export async function deliver(
  runtime: WatchRuntime,
  event: PulledUsageProcessingEvent,
  now: number,
): Promise<void> {
  const envelope: ProcessEventEnvelope = {
    eventId: event.id,
    eventType: event.type,
    occurredAt: event.occurredAt,
    tenantId: event.tenantId,
    projectId: event.tenantId,
    processKey: runtime.config.keyBy!(event),
    payload: runtime.config.toPayload!(event),
  };
  await runtime.service.handleEvent({ envelope, now });
}

export async function instanceOf(runtime: WatchRuntime, tenantId: string) {
  return await runtime.store.findByRef<CostRollupWatchState>({
    ref: refFor(runtime, tenantId),
  });
}

/** Runs one organization's armed check at its own slot. */
export async function runDueCheck(runtime: WatchRuntime, tenantId: string) {
  const instance = await instanceOf(runtime, tenantId);
  if (!instance?.nextWakeAt) {
    throw new Error(`no check armed for ${tenantId}`);
  }
  runtime.clock = Math.max(runtime.clock, instance.nextWakeAt);
  return await runtime.service.handleWake({
    wake: {
      ref: refFor(runtime, tenantId),
      revision: instance.revision,
      wakeAt: instance.nextWakeAt,
    },
    now: runtime.clock,
  });
}

/**
 * One pass of the machinery that answers checks, over every armed check in
 * the database — the production wake path rather than a hand-aimed call. The
 * batch is raised well above the default because the lane shares a Postgres
 * and the scan is global.
 */
export async function sweepDueChecks(runtime: WatchRuntime): Promise<void> {
  const worker = new ProcessWakeWorker({
    store: runtime.store,
    managers: { [COST_ROLLUP_WATCH_PROCESS_NAME]: runtime.service },
    logger: runtime.testLogger,
    batchSize: 200,
    intervalMs: 3_600_000,
    now: () => runtime.clock,
  });
  worker.start();
  await worker.stop();
}

/**
 * Drains the outbox `passes` times, advancing the clock by `stepMs` before
 * each. The step is what separates draining what is due now from draining
 * across a retry ladder: too small a step leaves a backed-off message behind
 * and mistakes a wait for a refusal.
 */
export async function drainPasses(
  runtime: WatchRuntime,
  { passes, stepMs }: { passes: number; stepMs: number },
) {
  const reports = [];
  for (let pass = 0; pass < passes; pass++) {
    runtime.clock += stepMs;
    reports.push(
      await runtime.dispatcher.runOnce({ now: runtime.clock, limit: 500 }),
    );
  }
  return reports;
}

/**
 * The outbox key the runtime actually writes for a key the definition
 * authored.
 *
 * Outbox uniqueness is on `(processName, projectId, messageKey)`, which says
 * nothing about which instance of a keyed process asked, so the builder
 * qualifies every authored key with the process key
 * (`buildIntentFactories`, src/server/event-sourcing/pipeline/processManagerDefinition.ts).
 * Asserting the bare key would pass against a build that had quietly stopped
 * qualifying them and let two organizations collide.
 */
export function outboxKey(
  runtime: WatchRuntime,
  { key, tenantId }: { key: string; tenantId: string },
): string {
  const ref = refFor(runtime, tenantId);
  return `process:${encodeURIComponent(ref.processKey)}:${key}`;
}

/**
 * Delegates to the comparator that ships, and keeps what it answered — for
 * THIS organization only.
 *
 * The dispatcher drains every due row this process owns, and the datastore
 * lane shares one Postgres, so a comparison still retrying from an earlier
 * organization becomes due as soon as a later test moves the clock on and is
 * answered here. Recording it would put another organization's answer in
 * this test's list, which is the same reason `daysComparedFor` filters.
 */
export async function compareForReal(
  runtime: WatchRuntime,
  params: CompareParams,
): Promise<CostRollupComparison> {
  const comparison = await runtime.realComparator.compareDay({
    tenantId: params.tenantId,
    day: params.day,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
  });
  if (params.tenantId === runtime.tenant) runtime.comparisons.push(comparison);
  return comparison;
}

/**
 * What a stub comparator answers when the test does not care what was found:
 * agreement.
 *
 * A bare `undefined` would have done while the handler only ever called the
 * comparator, but it now READS the answer to decide whether to look again, so
 * a stub has to say something a real comparison could have said.
 */
export function agreedComparison(params: CompareParams): CostRollupComparison {
  return {
    day: params.day,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
    mismatches: [],
    lagMs: 0,
    behind: [],
  };
}

/** Everything a fresh test starts from, applied onto the stable runtime box. */
export function resetPerTest(runtime: WatchRuntime): void {
  runtime.tenantSeq += 1;
  runtime.tenant = `${runtime.prefix}-${runtime.tenantSeq}`;
  runtime.clock = NOW;
  runtime.compareDayCalls = [];
  runtime.comparisons = [];
  runtime.compareDayImpl = async (params) => agreedComparison(params);

  const { config } = buildDefinition(runtime.comparator);
  runtime.config = config as WatchConfig;
  runtime.service = new ProcessManagerService<CostRollupWatchState>({
    store: runtime.store,
    definition: buildProcessDefinition(
      config,
    ) as ProcessDefinition<CostRollupWatchState>,
  });
  runtime.dispatcher = new OutboxDispatcherService({
    store: runtime.store,
    handlers: buildIntentHandlers(config),
    processNames: [COST_ROLLUP_WATCH_PROCESS_NAME],
    // The attempt ladder that ships, not the dispatcher's default of ten.
    // Taking the default would let "not attempted a sixth time" pass for the
    // wrong reason on a build that had changed the budget.
    maxAttempts: runtime.config.outbox?.maxAttempts,
    retryDelayMs: runtime.config.outbox?.retryDelayMs,
    leaseDurationMs: runtime.config.outbox?.leaseDurationMs,
  });
}

export async function cleanupPrefix(prefix: string): Promise<void> {
  const scope = { projectId: { startsWith: prefix } };
  await cleanupTestRows(prisma, [
    ["processManagerOutboxAttempt", scope],
    [
      "processManagerOutbox",
      { processName: COST_ROLLUP_WATCH_PROCESS_NAME, ...scope },
    ],
    [
      "processManagerInbox",
      { processName: COST_ROLLUP_WATCH_PROCESS_NAME, ...scope },
    ],
    [
      "processManagerInstance",
      { processName: COST_ROLLUP_WATCH_PROCESS_NAME, ...scope },
    ],
  ]);
}

export function registerLifecycle(runtime: WatchRuntime): void {
  beforeAll(() => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    runtime.ch = client;
    runtime.repo = new GovernanceCostRollupClickHouseRepository(
      async () => runtime.ch,
    );
    runtime.realComparator = new CostRollupComparatorService(runtime.repo);
  });
  beforeEach(() => resetPerTest(runtime));
  afterAll(() => cleanupPrefix(runtime.prefix));
}
