// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The substrate the drift check's integration suites drive: Postgres holds the
 * instance, the inbox and the outbox, and ClickHouse holds the summary the
 * comparison reads.
 *
 * `createWatchHarness` is a FACTORY, called once at the top of each suite,
 * and it registers its own `beforeAll` / `beforeEach` / `afterAll`. Nothing
 * mutable lives at module scope: the check's suites run in the datastore lane
 * with a shared module registry, so a module-level `let` here would be one
 * variable shared by every file that imported it.
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
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type { ProcessManagerConfig } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  OutboxDispatcherService,
  PrismaProcessStore,
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

type CompareParams = { tenantId: string; day: string; costSource: string };

export function createWatchHarness({ tenantPrefix }: { tenantPrefix: string }) {
  const prefix = `${tenantPrefix}-${nanoid(8)}`;
  const testLogger = createLogger("test:cost-rollup-watch-integration");
  const store = new PrismaProcessStore(prisma);

  let ch: ClickHouseClient;
  let repo: GovernanceCostRollupClickHouseRepository;
  let realComparator: CostRollupComparatorService;

  let tenantSeq = 0;
  let tenant: string;
  let clock: number;

  /**
   * What the process's intent handler is wired to. The implementation is
   * swapped per test — the real comparator where the assertion is about the
   * summary, one that always throws where it is about the retry ladder — while
   * the recorder around it stays the same, so "which comparisons were asked
   * for" reads the same way in every scenario.
   */
  let compareDayImpl: (params: CompareParams) => Promise<unknown>;
  let compareDayCalls: CompareParams[];
  let comparisons: CostRollupComparison[];

  const comparator: CostRollupComparatorDayComparer = {
    compareDay: async (params) => {
      compareDayCalls.push(params);
      return await compareDayImpl(params);
    },
  };

  let config: ProcessManagerConfig<any, any, PulledUsageProcessingEvent>;
  let service: ProcessManagerService<CostRollupWatchState>;
  let dispatcher: OutboxDispatcherService;

  function definition() {
    return buildProcessManager<PulledUsageProcessingEvent>({
      name: COST_ROLLUP_WATCH_PROCESS_NAME,
      applier: costRollupWatchPM({ comparator }),
    });
  }

  /** One charge, as the log holds it: the tenant, the item stream, the moment. */
  function charge({
    tenantId = tenant,
    occurredAtMs = NOW,
    eventType = PULLED_USAGE_EVENT_TYPES.OBSERVED,
    eventId = `evt-${nanoid(10)}`,
    aggregateId = `item-${nanoid(6)}`,
  }: {
    tenantId?: string;
    occurredAtMs?: number;
    eventType?: string;
    eventId?: string;
    aggregateId?: string;
  } = {}): PulledUsageProcessingEvent {
    return {
      id: eventId,
      type: eventType,
      tenantId,
      aggregateId,
      occurredAt: occurredAtMs,
      data: { restatementKey: aggregateId, occurredAtMs },
    } as unknown as PulledUsageProcessingEvent;
  }

  /** Delivers one charge exactly as the generated subscriber would. */
  async function record(
    event: PulledUsageProcessingEvent,
    { now = clock }: { now?: number } = {},
  ): Promise<void> {
    const envelope: ProcessEventEnvelope = {
      eventId: event.id,
      eventType: event.type,
      occurredAt: event.occurredAt,
      tenantId: event.tenantId,
      projectId: event.tenantId,
      processKey: config.keyBy!(event),
      payload: config.toPayload!(event),
    };
    await service.handleEvent({ envelope, now });
  }

  function refFor(tenantId = tenant) {
    return {
      processName: COST_ROLLUP_WATCH_PROCESS_NAME,
      projectId: tenantId,
      processKey: config.keyBy!(charge({ tenantId })),
    };
  }

  async function instanceOf(tenantId = tenant) {
    return await store.findByRef<CostRollupWatchState>({
      ref: refFor(tenantId),
    });
  }

  /** Runs one organization's armed check at its own slot. */
  async function runDueCheck(tenantId = tenant) {
    const instance = await instanceOf(tenantId);
    if (!instance?.nextWakeAt) {
      throw new Error(`no check armed for ${tenantId}`);
    }
    clock = Math.max(clock, instance.nextWakeAt);
    return await service.handleWake({
      wake: {
        ref: refFor(tenantId),
        revision: instance.revision,
        wakeAt: instance.nextWakeAt,
      },
      now: clock,
    });
  }

  /**
   * Answers one wake exactly as it was scheduled — the hand-aimed path, for
   * the tests that need to hold a wake at a revision and deliver it late.
   */
  async function handleWake(wake: {
    ref: ReturnType<typeof refFor>;
    revision: number;
    wakeAt: number;
  }) {
    return await service.handleWake({ wake, now: clock });
  }

  /**
   * One pass of the machinery that answers checks, over every armed check in
   * the database — the production wake path rather than a hand-aimed call. The
   * batch is raised well above the default because the lane shares a Postgres
   * and the scan is global.
   */
  async function sweepDueChecks(): Promise<void> {
    const worker = new ProcessWakeWorker({
      store,
      managers: { [COST_ROLLUP_WATCH_PROCESS_NAME]: service },
      logger: testLogger,
      batchSize: 200,
      intervalMs: 3_600_000,
      now: () => clock,
    });
    worker.start();
    await worker.stop();
  }

  /** Drains the outbox at the present clock, for intents that are due now. */
  async function drainOutbox({ passes = 3 }: { passes?: number } = {}) {
    const reports = [];
    for (let pass = 0; pass < passes; pass++) {
      clock += 1_000;
      reports.push(await dispatcher.runOnce({ now: clock, limit: 500 }));
    }
    return reports;
  }

  /**
   * Drains far enough apart that each retry's backoff has elapsed. The ladder
   * tops out at eight minutes, so ten minutes a pass never leaves a due
   * message behind and mistakes a wait for a refusal.
   */
  async function drainThroughRetries({ passes }: { passes: number }) {
    const reports = [];
    for (let pass = 0; pass < passes; pass++) {
      clock += 600_000;
      reports.push(await dispatcher.runOnce({ now: clock, limit: 500 }));
    }
    return reports;
  }

  /** The comparisons asked for on this organization, in the order they ran. */
  function daysComparedFor(tenantId = tenant): string[] {
    return compareDayCalls
      .filter((call) => call.tenantId === tenantId)
      .map((call) => call.day);
  }

  function comparisonsWithSource(costSource: string): CompareParams[] {
    return compareDayCalls.filter((call) => call.costSource === costSource);
  }

  async function messagesFor(tenantId = tenant) {
    return await store.findMessagesByRef({ ref: refFor(tenantId) });
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
  function outboxKey(key: string, tenantId = tenant): string {
    return `process:${encodeURIComponent(refFor(tenantId).processKey)}:${key}`;
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
  async function compareForReal(params: CompareParams): Promise<unknown> {
    const comparison = await realComparator.compareDay({
      tenantId: params.tenantId,
      day: params.day,
      costSource: GOVERNANCE_COST_SOURCE.PULLED,
    });
    if (params.tenantId === tenant) comparisons.push(comparison);
    return comparison;
  }

  /** The comparison the retry ladder is measured against: it never succeeds. */
  async function compareAndFail(): Promise<never> {
    throw new Error("comparison unavailable");
  }

  beforeAll(() => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    ch = client;
    repo = new GovernanceCostRollupClickHouseRepository(async () => ch);
    realComparator = new CostRollupComparatorService(repo);
  });

  beforeEach(() => {
    tenantSeq += 1;
    tenant = `${prefix}-${tenantSeq}`;
    clock = NOW;
    compareDayCalls = [];
    comparisons = [];
    compareDayImpl = async () => undefined;
    config = definition().config as typeof config;
    service = new ProcessManagerService<CostRollupWatchState>({
      store,
      definition: buildProcessDefinition(
        definition().config,
      ) as ProcessDefinition<CostRollupWatchState>,
    });
    dispatcher = new OutboxDispatcherService({
      store,
      handlers: buildIntentHandlers(definition().config),
      processNames: [COST_ROLLUP_WATCH_PROCESS_NAME],
      // The attempt ladder that ships, not the dispatcher's default of ten.
      // Taking the default would let "not attempted a sixth time" pass for the
      // wrong reason on a build that had changed the budget.
      maxAttempts: config.outbox?.maxAttempts,
      retryDelayMs: config.outbox?.retryDelayMs,
      leaseDurationMs: config.outbox?.leaseDurationMs,
    });
  });

  afterAll(async () => {
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
  });

  return {
    definition,
    store,
    charge,
    record,
    refFor,
    instanceOf,
    runDueCheck,
    handleWake,
    sweepDueChecks,
    drainOutbox,
    drainThroughRetries,
    daysComparedFor,
    comparisonsWithSource,
    messagesFor,
    outboxKey,
    compareForReal,
    compareAndFail,
    /** Forgets the comparisons asked for so far, keeping the instance as it is. */
    forgetComparisons: () => {
      compareDayCalls = [];
    },
    /** Swaps what the intent handler does on its next attempt. */
    compareWith: (impl: (params: CompareParams) => Promise<unknown>) => {
      compareDayImpl = impl;
    },
    appendObserved: (params: {
      costNanoMinor: number;
      occurredAtMs?: number;
    }) => summary.appendObserved({ ch, tenantId: tenant, ...params }),
    writeSummary: (amountNanoMinor: number) =>
      summary.writeSummary({ repo, tenantId: tenant, amountNanoMinor }),
    summarizedAmountsFor: (day: string) =>
      summary.summarizedAmountsFor({ repo, tenantId: tenant, day }),
    eventLogCount: () => summary.eventLogCount({ ch, tenantId: tenant }),
    mismatchCount: () => summary.mismatchCount(),
    wakeLag: () => summary.wakeLag(),
    get tenant() {
      return tenant;
    },
    get comparisons() {
      return comparisons;
    },
    get clock() {
      return clock;
    },
    set clock(value: number) {
      clock = value;
    },
  };
}
