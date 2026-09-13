// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The drift check against the substrate it actually runs on: Postgres holds
 * the instance, the inbox and the outbox, and ClickHouse holds the summary the
 * comparison reads.
 *
 * The unit suite next door drives the same definition against an in-memory
 * store, which is enough to pin what the process DECIDES. Everything here
 * needs something that store only imitates: the outbox's uniqueness on
 * `(processName, projectId, messageKey)` is what makes a redelivered check
 * slot compare a day once; the revision fence is what makes a charge landing
 * mid-check retry rather than stand down; the attempt ladder and the dead row
 * are the only trace a comparison that died leaves behind; and a drift count
 * is only real when a real comparator reads a real summary.
 *
 * Isolation is by tenant, the way the sibling process-manager suites do it:
 * the process name is the one that ships, and every organization here carries
 * a namespaced id, so this file's rows can never be confused with another
 * run's. Assertions are scoped to those ids for the same reason — the
 * datastore lane shares one Postgres, and a system-wide sweep legitimately
 * sees whatever else is in it.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createPulledUsageProcessingPipeline } from "@ee/event-sourcing/pipelines/pulled-usage-processing/pipeline";
import {
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
} from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
} from "@ee/governance/projections/governanceCostRollup.constants";
import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
} from "@ee/governance/projections/governanceCostRollup.foldProjection";
import { projectGovernanceCostRollupStateToRow } from "@ee/governance/projections/governanceCostRollup.store";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { register } from "prom-client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type { ProcessManagerConfig } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { GATEWAY_SPEND_PROCESSING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
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
  ProcessRuntime,
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

const ns = `cost-watch-int-${nanoid(8)}`;

/**
 * Every organization here is a hidden governance project whose id starts with
 * this, which is what the teardown filter keys on.
 */
const TENANT_PREFIX = `proj-gov-${ns}`;

/** An ordinary working morning, hours after that day's slot has passed. */
const NOW = Date.UTC(2026, 8, 10, 8, 0, 0);
const TODAY = "2026-09-10";
const YESTERDAY = "2026-09-09";
const YESTERDAY_MS = Date.UTC(2026, 8, 9, 22, 0, 0);

/** The slot every charge recorded at `NOW` arms, and the one after it. */
const TONIGHT = Date.UTC(2026, 8, 11, 4, 23, 0);
const TOMORROW_NIGHT = Date.UTC(2026, 8, 12, 4, 23, 0);

const testLogger = createLogger("test:cost-rollup-watch-integration");

/**
 * The comparator's own logger, reached through the logger cache by name — the
 * same instance the service module captured at import.
 */
const comparatorLogger = createLogger(
  "langwatch:governance:cost-rollup:comparator",
);

const store = new PrismaProcessStore(prisma);

let ch: ClickHouseClient;
let repo: GovernanceCostRollupClickHouseRepository;
let realComparator: CostRollupComparatorService;

let tenantSeq = 0;
let tenant: string;
let clock: number;

/**
 * What the process's intent handler is wired to. The implementation is swapped
 * per test — the real comparator where the assertion is about the summary, one
 * that always throws where it is about the retry ladder — while the recorder
 * around it stays the same, so "which comparisons were asked for" reads the
 * same way in every scenario.
 */
let compareDayImpl: (params: {
  tenantId: string;
  day: string;
  costSource: string;
}) => Promise<unknown>;
let compareDayCalls: Array<{
  tenantId: string;
  day: string;
  costSource: string;
}>;
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

/**
 * Delegates to the comparator that ships, and keeps what it answered — for
 * THIS organization only.
 *
 * The dispatcher drains every due row this process owns, and the datastore
 * lane shares one Postgres, so a comparison still retrying from an earlier
 * organization becomes due as soon as a later test moves the clock on and is
 * answered here. Recording it would put another organization's answer in this
 * test's list, which is the same reason `daysComparedFor` filters.
 */
async function compareForReal(params: {
  tenantId: string;
  day: string;
}): Promise<unknown> {
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

function refFor(tenantId: string) {
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
 * One pass of the machinery that answers checks, over every armed check in the
 * database — the production wake path rather than a hand-aimed call. The batch
 * is raised well above the default because the lane shares a Postgres and the
 * scan is global.
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
 * tops out at eight minutes, so ten minutes a pass never leaves a due message
 * behind and mistakes a wait for a refusal.
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

async function messagesFor(tenantId = tenant) {
  return await store.findMessagesByRef({ ref: refFor(tenantId) });
}

/**
 * The outbox key the runtime actually writes for a key the definition authored.
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
 * One pulled observation's payload, as the puller worker writes it. The shape
 * mirrors `costRollupComparator.service.integration.test.ts`, which is the
 * suite that owns what the fold reads out of it.
 */
function observedData({
  costNanoMinor,
  occurredAtMs,
  restatementKey,
}: {
  costNanoMinor: number;
  occurredAtMs: number;
  restatementKey: string;
}) {
  return {
    itemKey: `usage_report:${TODAY}:1d`,
    restatementKey,
    source: "anthropic_admin",
    ingestionSourceId: "src_1",
    organizationId: "org_acme",
    teamId: "team_platform",
    projectId: tenant,
    model: "anthropic/claude-sonnet-5",
    tokensInput: 1_000,
    tokensOutput: 200,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    costNanoMinor,
    currencyCode: "USD",
    costNanoUsd: null,
    rawActorId: "",
    rateVersion: "registry@2026-08-01",
    costBasis: "computed",
    costStatus: "estimate",
    occurredAtMs,
    observedAtMs: occurredAtMs,
  };
}

/**
 * Puts one observation on the durable log, dated to the day its business time
 * falls in — the envelope time is the column the comparator selects by, and
 * the puller writes the item's own moment to it.
 */
async function appendObserved({
  costNanoMinor,
  occurredAtMs = NOW,
}: {
  costNanoMinor: number;
  occurredAtMs?: number;
}): Promise<void> {
  const restatementKey = `bucket-${nanoid(6)}`;
  await ch.insert({
    table: "event_log",
    values: [
      {
        TenantId: tenant,
        IdempotencyKey: `idem-${nanoid()}`,
        AggregateType: "pulled_usage",
        AggregateId: restatementKey,
        EventId: `evt-${nanoid()}`,
        EventType: PULLED_USAGE_EVENT_TYPES.OBSERVED,
        EventVersion: PULLED_USAGE_EVENT_VERSIONS.OBSERVED,
        EventTimestamp: Date.now(),
        EventPayload: JSON.stringify(
          observedData({ costNanoMinor, occurredAtMs, restatementKey }),
        ),
        EventOccurredAt: occurredAtMs,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * Writes the day's summary at whatever figure the test wants it to claim, by
 * folding one observation through the real projection. Hand-writing the row
 * would let the comparison agree with a summary the fold could never produce.
 */
async function writeSummary(amountNanoMinor: number): Promise<void> {
  const projection = new GovernanceCostRollupFoldProjection({
    store: { store: async () => undefined, get: async () => null },
  });
  const state: GovernanceCostRollupState = projection.apply(projection.init(), {
    id: `evt-${nanoid()}`,
    type: PULLED_USAGE_EVENT_TYPES.OBSERVED,
    tenantId: tenant,
    aggregateId: "seed",
    occurredAt: NOW,
    data: observedData({
      costNanoMinor: amountNanoMinor,
      occurredAtMs: NOW,
      restatementKey: "seed",
    }),
  } as never);
  await repo.upsert(
    projectGovernanceCostRollupStateToRow({
      state,
      tenantId: tenant,
      version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      appliedEventIds: [],
    }),
  );
}

async function summarizedAmountsFor(day: string): Promise<number[]> {
  const cells = await repo.findCellsForDay({
    tenantId: tenant,
    day,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
  });
  return cells.map((cell) => cell.AmountNanoMinor).sort((a, b) => a - b);
}

/** How many events this organization's log holds, of any type. */
async function eventLogCount(): Promise<number> {
  const result = await ch.query({
    query:
      "SELECT count() AS total FROM event_log WHERE TenantId = {tenantid:String}",
    query_params: { tenantid: tenant },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ total: string }>();
  return Number(rows[0]?.total ?? 0);
}

/** The drift counter, summed over the billed lane. */
async function mismatchCount(): Promise<number> {
  const metric = register.getSingleMetric(
    "langwatch_governance_cost_rollup_mismatch_total",
  );
  const values = (await metric!.get()).values;
  return values
    .filter(
      (value) => value.labels.cost_source === GOVERNANCE_COST_SOURCE.PULLED,
    )
    .reduce((sum, value) => sum + value.value, 0);
}

/** How many wakes this process answered, and how late they were in total. */
async function wakeLag(): Promise<{ count: number; sumMs: number }> {
  const metric = register.getSingleMetric("es_process_wake_lag_milliseconds");
  const values = (await metric!.get()).values;
  const mine = values.filter(
    (value) => value.labels.process_name === COST_ROLLUP_WATCH_PROCESS_NAME,
  );
  // A histogram's `_sum` and `_count` rows carry the derived metric name at
  // runtime; prom-client's value type does not declare it.
  const of = (suffix: string) =>
    mine.find((value) =>
      (value as { metricName?: string }).metricName?.endsWith(suffix),
    )?.value ?? 0;
  return { count: of("_count"), sumMs: of("_sum") };
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
  tenant = `${TENANT_PREFIX}-${tenantSeq}`;
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
  const scope = { projectId: { startsWith: TENANT_PREFIX } };
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

describe("a charge and a check racing each other", () => {
  describe("given a day marked and its check already due", () => {
    /** @scenario A charge arriving while the check is running is not lost */
    it("retries the losing side and compares both days", async () => {
      await record(charge());
      const armed = await instanceOf();
      // The wake the machinery picked up, captured at the revision it was
      // scheduled at — the state the losing side of the race holds.
      const inFlight = {
        ref: refFor(tenant),
        revision: armed!.revision,
        wakeAt: armed!.nextWakeAt!,
      };

      clock = TONIGHT;
      await record(charge({ occurredAtMs: YESTERDAY_MS }));
      const result = await service.handleWake({ wake: inFlight, now: clock });

      // It stood down without asking for anything — and, crucially, without
      // clearing the marks it was holding. `staleWake` is what the runtime
      // calls standing down: a wake is only valid at the revision it was
      // scheduled at, and the charge that landed meanwhile moved it.
      expect(result.outcome).toBe("staleWake");
      await drainOutbox();
      expect(daysComparedFor()).toEqual([]);

      // The instance is still armed at a moment that has passed, so the next
      // pass of the machinery picks it up and compares both days at once.
      await sweepDueChecks();
      await drainOutbox();

      expect(daysComparedFor().sort()).toEqual([YESTERDAY, TODAY]);
      const cleared = await instanceOf();
      expect(cleared?.state.pendingDays).toEqual([]);
      expect(cleared?.nextWakeAt).toBeNull();
    });
  });
});

describe("recognising a repeat of one check slot", () => {
  describe("given a day compared at last night's check", () => {
    /** @scenario The same check slot delivered twice compares a day only once */
    it("compares the day once and raises the drift count once", async () => {
      compareDayImpl = compareForReal;
      await appendObserved({ costNanoMinor: 5_000_000_000 });
      await writeSummary(9_999_000_000);
      await record(charge());
      await runDueCheck();
      await drainOutbox();
      const driftAfterFirst = await mismatchCount();
      expect(daysComparedFor()).toEqual([TODAY]);

      // The redelivery this design expects: the slot comes round again — a
      // check that ran and crashed before being recorded as done — so the
      // same day is asked for at the same slot a second time. The mark
      // counter is carried over from the state the check left behind, which
      // is what makes this a repeat of that check rather than a new question:
      // nothing marked the day again in between.
      const compared = await instanceOf();
      const marks = compared!.state.marks;
      await store.commit({
        ref: refFor(tenant),
        tenantId: tenant,
        state: { pendingDays: [TODAY], armedAt: TONIGHT, marks },
        expectedRevision: compared!.revision,
        nextWakeAt: TONIGHT,
        sourceEventId: null,
        messages: [],
        now: clock,
      });
      const replay = await runDueCheck();
      await drainOutbox();

      // The outbox recognised the key rather than inserting a second row.
      if (replay.outcome !== "committed") {
        throw new Error(`replayed wake did not commit: ${replay.outcome}`);
      }
      expect(replay.insertedMessageKeys).toEqual([]);
      expect(replay.duplicateMessageKeys).toEqual([
        outboxKey(`compare:${TODAY}:${TONIGHT}:${marks}`),
      ]);
      expect(daysComparedFor()).toEqual([TODAY]);
      // Asserted alongside the run because a second pass of a read-only
      // comparison is otherwise invisible while it doubles what we report.
      expect(await mismatchCount()).toBe(driftAfterFirst);
    });
  });

  describe("given a day marked again after its comparison", () => {
    /** @scenario A day marked again after its comparison is compared again at the next slot */
    it("compares it again at the next slot", async () => {
      await record(charge());
      await runDueCheck();
      await drainOutbox();
      expect(daysComparedFor()).toEqual([TODAY]);

      clock = TONIGHT + 3_600_000;
      await record(charge({ occurredAtMs: NOW }));
      expect((await instanceOf())?.state.armedAt).toBe(TOMORROW_NIGHT);

      await runDueCheck();
      await drainOutbox();

      expect(daysComparedFor()).toEqual([TODAY, TODAY]);
      // The slot and the mark counter are both part of what identifies a
      // comparison, so the second one is a new row rather than a repeat the
      // outbox would suppress: a new slot, and the day marked a second time.
      const keys = (await messagesFor())
        .map((message) => message.messageKey)
        .sort();
      expect(keys).toEqual(
        [
          outboxKey(`compare:${TODAY}:${TONIGHT}:1`),
          outboxKey(`compare:${TODAY}:${TOMORROW_NIGHT}:2`),
        ].sort(),
      );
    });
  });
});

describe("leaving quiet organizations alone", () => {
  describe("given an organization with no pulled charges at all", () => {
    /** @scenario An organization that has never pulled a bill has nothing armed */
    it("has no check of its own and is never compared", async () => {
      const quiet = `${TENANT_PREFIX}-quiet-${tenantSeq}`;
      // Another organization's charge, so the sweep below has real work.
      await record(charge());

      clock = TONIGHT;
      await sweepDueChecks();
      await drainOutbox();

      expect(await instanceOf(quiet)).toBeNull();
      expect(daysComparedFor(quiet)).toEqual([]);
    });
  });

  describe("given an organization whose requests went through the gateway", () => {
    /** @scenario Gateway spend does not mark a day */
    it("never routes gateway spend to the check and compares no gateway lane", async () => {
      // The routing IS the generated subscriber's event list: a gateway spend
      // event is never delivered to this process, so there is nothing for it
      // to mark a day from.
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const { subscribers } =
        runtime.registerPipeline<PulledUsageProcessingEvent>({
          pipelineName: "pulled-usage-processing",
          processManagers: new Map([
            [COST_ROLLUP_WATCH_PROCESS_NAME, definition()],
          ]),
        });
      const watch = subscribers.find(
        (subscriber) =>
          subscriber.name === `pm:${COST_ROLLUP_WATCH_PROCESS_NAME}`,
      );
      if (!watch) throw new Error("the runtime generated no watch subscriber");
      expect(
        watch.eventTypes.filter((type) =>
          (GATEWAY_SPEND_PROCESSING_EVENT_TYPES as readonly string[]).includes(
            type,
          ),
        ),
      ).toEqual([]);
      await runtime.stop();

      await record(charge());
      clock = TONIGHT;
      await sweepDueChecks();
      await drainOutbox();

      expect(
        compareDayCalls.filter(
          (call) => call.costSource === GOVERNANCE_COST_SOURCE.GATEWAY,
        ),
      ).toEqual([]);
    });
  });

  describe("given a day that was compared and has received nothing since", () => {
    /** @scenario A quiet day is never re-checked on its own */
    it("is not compared again at a later check", async () => {
      await record(charge());
      await runDueCheck();
      await drainOutbox();
      expect(daysComparedFor()).toEqual([TODAY]);

      // A later check comes due, armed by a charge on another day only.
      clock = TONIGHT + 3_600_000;
      await record(charge({ occurredAtMs: YESTERDAY_MS }));
      await runDueCheck();
      await drainOutbox();

      expect(daysComparedFor()).toEqual([TODAY, YESTERDAY]);
    });
  });
});

describe("retrying a comparison that fails", () => {
  beforeEach(() => {
    compareDayImpl = compareAndFail;
  });

  describe("given a comparison that failed on each of its first three attempts", () => {
    /** @scenario A comparison that has failed three times is attempted a fourth */
    it("attempts it a fourth time", async () => {
      await record(charge());
      await runDueCheck();

      await drainThroughRetries({ passes: 3 });
      expect(daysComparedFor()).toHaveLength(3);

      await drainThroughRetries({ passes: 1 });

      expect(daysComparedFor()).toEqual([TODAY, TODAY, TODAY, TODAY]);
      const [message] = await messagesFor();
      expect(message?.status).toBe("pending");
    });
  });

  describe("given a comparison that failed on each of its first five attempts", () => {
    /** @scenario A comparison that has failed five times is not attempted again */
    it("stops at five and records that it gave up", async () => {
      await record(charge());
      await runDueCheck();

      await drainThroughRetries({ passes: 5 });
      expect(daysComparedFor()).toHaveLength(5);

      // Two further passes, each well past any backoff the ladder can ask for.
      await drainThroughRetries({ passes: 2 });

      expect(daysComparedFor()).toHaveLength(5);
      const [message] = await messagesFor();
      expect(message?.status).toBe("dead");
      // The record that a comparison died, which is the only trace it leaves.
      const attempts = await prisma.processManagerOutboxAttempt.findMany({
        where: { projectId: tenant },
        orderBy: { attempt: "asc" },
      });
      expect(attempts.map((attempt) => attempt.outcome)).toEqual([
        "retry_scheduled",
        "retry_scheduled",
        "retry_scheduled",
        "retry_scheduled",
        "dead",
      ]);
    });
  });

  describe("given a comparison that fails every time it is attempted", () => {
    /** @scenario A failing comparison does not stop charges being recorded */
    it("keeps recording charges and marking their days", async () => {
      await record(charge());
      await runDueCheck();
      await drainThroughRetries({ passes: 6 });
      expect((await messagesFor())[0]?.status).toBe("dead");

      clock = TONIGHT + 3_600_000;
      await record(charge({ occurredAtMs: NOW }));
      await record(charge({ occurredAtMs: YESTERDAY_MS }));

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, YESTERDAY]);
      expect(instance?.state.armedAt).toBe(TOMORROW_NIGHT);
      expect(instance?.nextWakeAt).toBe(TOMORROW_NIGHT);
    });
  });

  describe("given a comparison for a day that gave up after its last attempt", () => {
    /** @scenario A comparison that gave up is not picked up by a later check */
    it("leaves that day uncompared at the next check", async () => {
      await record(charge());
      await runDueCheck();
      await drainThroughRetries({ passes: 6 });
      expect((await messagesFor())[0]?.status).toBe("dead");

      // Whatever was wrong is over, and a charge lands on a DIFFERENT day.
      compareDayImpl = async () => undefined;
      compareDayCalls = [];
      clock = TONIGHT + 3_600_000;
      await record(charge({ occurredAtMs: YESTERDAY_MS }));
      await runDueCheck();
      await drainOutbox();

      // A known gap, stated rather than hidden: the dead day is only
      // re-checked if something new lands on it.
      expect(daysComparedFor()).toEqual([YESTERDAY]);
    });
  });
});

describe("mounting the check only where a summary exists", () => {
  describe("given a deployment where the cost summary store is not configured", () => {
    /** @scenario A deployment that holds no summary at all asks for no comparisons */
    it("mounts nothing, so no comparison is asked for and none dies", async () => {
      const pipeline = createPulledUsageProcessingPipeline({});
      expect(pipeline.processManagers.has(COST_ROLLUP_WATCH_PROCESS_NAME)).toBe(
        false,
      );

      // The runtime generates subscribers from the pipeline's declaration, so
      // a pipeline that mounts nothing routes charges nowhere.
      const runtime = new ProcessRuntime({ store, consumersEnabled: false });
      const { subscribers } =
        runtime.registerPipeline<PulledUsageProcessingEvent>({
          pipelineName: "pulled-usage-processing",
          processManagers: pipeline.processManagers,
        });
      expect(subscribers.map((subscriber) => subscriber.name)).not.toContain(
        `pm:${COST_ROLLUP_WATCH_PROCESS_NAME}`,
      );
      await runtime.stop();

      clock = TONIGHT;
      await sweepDueChecks();
      await drainOutbox();

      expect(await instanceOf()).toBeNull();
      // Neither failure mode: no comparison asked for, and none dead.
      expect(await messagesFor()).toEqual([]);
      expect(daysComparedFor()).toEqual([]);
    });
  });
});

describe("answering a check that was missed", () => {
  describe("given a check whose moment passed with nothing running", () => {
    /** @scenario A check whose moment passed with nothing running fires once afterwards */
    it("answers it once, however many slots went by", async () => {
      await record(charge());
      await record(charge({ occurredAtMs: YESTERDAY_MS }));

      // Three nights later. Nothing answered any of them.
      clock = TONIGHT + 3 * 86_400_000;
      await sweepDueChecks();
      await drainOutbox();
      await sweepDueChecks();
      await drainOutbox();

      // One comparison per marked day, not one per slot that went by.
      expect(daysComparedFor().sort()).toEqual([YESTERDAY, TODAY]);
      expect(await messagesFor()).toHaveLength(2);
      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([]);
      expect(instance?.nextWakeAt).toBeNull();
    });
  });

  describe("given a check whose moment passed and which has not been answered", () => {
    /** @scenario A check that is overdue is visible without anyone knowing to look */
    it("is reported as overdue when the state of checks is read", async () => {
      await record(charge());
      const overdueBy = 6 * 3_600_000;
      clock = TONIGHT + overdueBy;

      const due = await store.findDueWakes({
        now: clock,
        limit: 200,
        processNames: [COST_ROLLUP_WATCH_PROCESS_NAME],
      });

      const mine = due.find((wake) => wake.ref.projectId === tenant);
      if (!mine) throw new Error("the overdue check was not reported as due");
      // Overdue is the check's own moment sitting behind the present, read
      // straight off the substrate rather than off a second surface.
      expect(clock - mine.wakeAt).toBe(overdueBy);

      // And how late it was is recorded when it is finally answered.
      const before = await wakeLag();
      await sweepDueChecks();
      const after = await wakeLag();
      expect(after.count).toBeGreaterThan(before.count);
      expect(after.sumMs - before.sumMs).toBeGreaterThanOrEqual(overdueBy);
    });
  });
});

describe("finding drift without changing anything", () => {
  beforeEach(() => {
    compareDayImpl = compareForReal;
  });

  describe("given a day's summary that no longer matches its recorded charges", () => {
    /** @scenario Drift found by a comparison is counted and logged, exactly as before */
    it("counts the drift and names both figures in the log", async () => {
      await appendObserved({ costNanoMinor: 5_000_000_000 });
      await appendObserved({ costNanoMinor: 7_340_000_000 });
      await writeSummary(9_999_000_000);
      // The spy sees the log object before pino serializes it, which is what
      // the line renders — a counter alone cannot say which way drift went.
      const logged = vi.spyOn(comparatorLogger, "error");

      const before = await mismatchCount();
      await record(charge());
      await runDueCheck();
      await drainOutbox();

      expect(await mismatchCount()).toBe(before + 1);
      const line = logged.mock.calls
        .map(([fields]) => fields as Record<string, unknown>)
        .find((fields) => fields?.tenantId === tenant);
      logged.mockRestore();
      expect(line).toBeDefined();
      expect(line!.day).toBe(TODAY);
      expect(line!.summarized_nano_minor).toBe(9_999_000_000);
      expect(line!.derived_nano_minor).toBe(12_340_000_000);
    });

    /** @scenario Finding drift leaves the summary exactly as it was */
    it("leaves the stored summary alone and records no correcting event", async () => {
      await appendObserved({ costNanoMinor: 5_000_000_000 });
      await writeSummary(9_999_000_000);
      const summaryBefore = await summarizedAmountsFor(TODAY);
      const eventsBefore = await eventLogCount();

      await record(charge());
      await runDueCheck();
      await drainOutbox();

      expect(comparisons[0]?.mismatches).toHaveLength(1);
      expect(await summarizedAmountsFor(TODAY)).toEqual(summaryBefore);
      expect(await eventLogCount()).toBe(eventsBefore);
    });
  });

  describe("given a day that has already been compared", () => {
    /** @scenario Comparing a day twice over changes nothing that is stored */
    it("reports the same finding the second time and stores nothing", async () => {
      await appendObserved({ costNanoMinor: 5_000_000_000 });
      await writeSummary(9_999_000_000);
      await record(charge());
      await runDueCheck();
      await drainOutbox();
      const summaryAfterFirst = await summarizedAmountsFor(TODAY);

      // A new slot, so the second comparison is a new question rather than a
      // repeat the outbox would recognise and suppress.
      clock = TONIGHT + 3_600_000;
      await record(charge({ occurredAtMs: NOW }));
      await runDueCheck();
      await drainOutbox();

      expect(comparisons).toHaveLength(2);
      expect(comparisons[1]!.mismatches).toEqual(comparisons[0]!.mismatches);
      expect(await summarizedAmountsFor(TODAY)).toEqual(summaryAfterFirst);
    });
  });
});
