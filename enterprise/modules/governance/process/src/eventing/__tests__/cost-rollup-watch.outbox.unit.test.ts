// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The watch through the process store and outbox ladder, the real comparer on memory stores. */
import {
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEvent,
} from "@langwatch/enterprise-governance-contract";
import {
  buildIntentHandlers,
  buildProcessDefinition,
  buildProcessManager,
  type DueWake,
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
  type ProcessRef,
} from "@langwatch/eventing";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CostRollupDayComparer, CostRollupDayLook } from "../../app/governance.members.ts";
import { MemoryGovernanceCostChargeRepository } from "../../repositories/memory/memory.governance-cost-charge.repository.ts";
import {
  COST_ROLLUP_MISMATCH_METRIC_NAME,
  CostRollupDayComparerService,
} from "../../services/cost-rollup-day-comparer.service.ts";
import {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  type CostRollupWatchState,
  CostRollupWatchProcess,
  nextCostRollupCheckAt,
} from "../cost-rollup-watch.process.ts";
import { GovernanceCostChargeMapProjection } from "../governance-cost-charge.projection.ts";
import { PulledUsageEventingAdapter } from "../pulled-usage.pipeline.ts";
import {
  DAY_START_MS,
  HOUR_MS,
  observed,
  rollupFold,
  TENANT_ID,
} from "./governance-cost-rollup.fixtures.ts";

const DAY_MS = 24 * HOUR_MS;
const FIRST_DAY = "2026-09-01";
const SECOND_DAY = "2026-09-02";
const PASS_MS = 10 * 60_000;

const WATCH_REF: ProcessRef = {
  processName: COST_ROLLUP_WATCH_PROCESS_NAME,
  projectId: TENANT_ID,
  processKey: `tenant:${TENANT_ID}`,
};

/** The real comparer, with every day it is asked about written down. */
class CountingComparer implements CostRollupDayComparer {
  readonly asked: string[] = [];
  readonly costSource: string;

  constructor(private readonly inner: CostRollupDayComparer) {
    this.costSource = inner.costSource;
  }

  compareDay(params: { tenantId: string; day: string }): Promise<CostRollupDayLook> {
    this.asked.push(params.day);
    return this.inner.compareDay(params);
  }
}

/** A comparer whose store is down: every look throws. */
class FailingComparer implements CostRollupDayComparer {
  readonly asked: string[] = [];
  readonly costSource = "pulled";

  compareDay(params: { tenantId: string; day: string }): Promise<CostRollupDayLook> {
    this.asked.push(params.day);
    return Promise.reject(new Error("cost summary store unavailable"));
  }
}

/** A charge lands in the charge record, maybe the summary, and marks the watch, as on a worker. */
function watchWorld({ failing = false }: { failing?: boolean } = {}) {
  const { repository: costRollup, projection } = rollupFold();
  const costCharges = MemoryGovernanceCostChargeRepository.create();
  const chargeRecord = GovernanceCostChargeMapProjection.create({
    store: costCharges,
    cells: projection,
  });
  const { logger, lines } = createTestLogger();
  const real = CostRollupDayComparerService.create({ costRollup, costCharges, logger });
  const comparer = failing ? new FailingComparer() : new CountingComparer(real);
  const config = buildProcessManager({
    name: COST_ROLLUP_WATCH_PROCESS_NAME,
    applier: CostRollupWatchProcess.create(comparer).processManager(),
  }).config;
  const store = InMemoryProcessStore.createForTesting();
  const service = new ProcessManagerService({ store, definition: buildProcessDefinition(config) });
  const dispatcher = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(config),
    maxAttempts: config.outbox?.maxAttempts,
    retryDelayMs: config.outbox?.retryDelayMs,
    processNames: [COST_ROLLUP_WATCH_PROCESS_NAME],
  });
  let clock = DAY_START_MS + HOUR_MS;

  const summarize = async (event: PulledUsageObservedEvent) => {
    const context = {
      aggregateId: event.aggregateId,
      tenantId: event.tenantId,
      key: projection.key(event),
    };
    const read = await projection.store.get(event.aggregateId, context);
    const previous = read.kind === "folded" ? read.state : projection.init();
    await projection.store.store(projection.apply(previous, event), context);
  };

  const record = async (
    event: PulledUsageObservedEvent,
    { summarized = true }: { summarized?: boolean } = {},
  ) => {
    const row = chargeRecord.map(event);
    if (row !== null) await costCharges.append(row);
    if (summarized) await summarize(event);
    return service.handleEvent({
      envelope: {
        eventId: event.id,
        eventType: event.type,
        occurredAt: event.occurredAt,
        tenantId: TENANT_ID,
        projectId: TENANT_ID,
        processKey: WATCH_REF.processKey,
        payload: { occurredAtMs: event.data.occurredAtMs },
      },
      now: clock,
    });
  };

  const dueWakes = () =>
    store.findDueWakes({ now: clock, limit: 10, processNames: [COST_ROLLUP_WATCH_PROCESS_NAME] });

  const onlyDueWake = async (): Promise<DueWake> => {
    const wakes = await dueWakes();
    const [wake] = wakes;
    if (wake === undefined || wakes.length !== 1) {
      throw new Error(`expected one due check, found ${wakes.length}`);
    }
    return wake;
  };

  const fireDueChecks = async () => {
    for (const wake of await dueWakes()) await service.handleWake({ wake, now: clock });
  };

  /** Each pass moves the clock past the ladder's longest wait and leases what is due. */
  const drain = async (passes = 8) => {
    for (let pass = 0; pass < passes; pass++) {
      clock += PASS_MS;
      await dispatcher.runOnce({ now: clock, limit: 50 });
    }
  };

  const toNextSlot = () => {
    clock = nextCostRollupCheckAt(clock);
  };

  return {
    comparer,
    real,
    costRollup,
    costCharges,
    lines,
    store,
    service,
    record,
    summarize,
    dueWakes,
    onlyDueWake,
    fireDueChecks,
    drain,
    toNextSlot,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    state: async () => (await store.findByRef<CostRollupWatchState>({ ref: WATCH_REF }))?.state,
    messages: () => store.findMessagesByRef({ ref: WATCH_REF }),
  };
}

const charge = (restatementKey: string, overrides: { costNanoMinor?: number } = {}) =>
  observed({ restatementKey, ...overrides });
const chargeOnSecondDay = (restatementKey: string) =>
  observed({ restatementKey, occurredAtMs: DAY_START_MS + DAY_MS });

/** A day whose summary folded 1_500 where the charge record holds 1_000, on one cell. */
async function driftingWorld() {
  const world = watchWorld();
  await world.record(charge("item-1", { costNanoMinor: 1_000 }), { summarized: false });
  await world.summarize(charge("item-1", { costNanoMinor: 1_500 }));
  return world;
}

let metrics: RecordingMeterProvider;

beforeEach(() => {
  metrics = createRecordingMeterProvider();
  metrics.install();
});

afterEach(() => {
  metrics.uninstall();
});

const driftCount = () =>
  metrics.valueOf(COST_ROLLUP_MISMATCH_METRIC_NAME, { cost_source: "pulled" });

describe("the cost rollup watch against its process store", () => {
  describe("given a day is marked and its check has been picked up", () => {
    /** @scenario "A charge arriving while the check is running is not lost" */
    it("compares both days when a charge for another day lands mid-check", async () => {
      const world = watchWorld();
      await world.record(charge("item-1"));
      world.toNextSlot();
      const running = await world.onlyDueWake();

      await world.record(chargeOnSecondDay("item-2"));
      await expect(world.service.handleWake({ wake: running, now: world.now() })).resolves.toEqual(
        expect.objectContaining({ outcome: "staleWake" }),
      );
      await world.fireDueChecks();
      await world.drain();

      expect(world.comparer.asked.toSorted()).toEqual([FIRST_DAY, SECOND_DAY]);
      expect((await world.state())?.pendingDays).toEqual([]);
      expect((await world.messages()).map((message) => message.status)).toEqual([
        "dispatched",
        "dispatched",
      ]);
    });
  });

  describe("given a day was compared at last night's check", () => {
    /** @scenario "The same check slot delivered twice compares a day only once" */
    it("asks once and counts the drift once when the slot is delivered again", async () => {
      const world = await driftingWorld();
      world.toNextSlot();
      const wake = await world.onlyDueWake();
      await world.service.handleWake({ wake, now: world.now() });
      await world.drain();
      const looks = world.comparer.asked.length;

      await world.service.handleWake({ wake, now: world.now() });
      await world.drain();

      expect(await world.messages()).toHaveLength(1);
      expect(world.comparer.asked).toHaveLength(looks);
      expect(driftCount()).toBe(1);
    });

    /** @scenario "A day marked again after its comparison is compared again at the next slot" */
    it("compares the day again at tonight's slot once a charge re-marks it", async () => {
      const world = watchWorld();
      await world.record(charge("item-1"));
      world.toNextSlot();
      await world.fireDueChecks();
      await world.drain();

      await world.record(charge("item-2"));
      world.toNextSlot();
      await world.fireDueChecks();
      await world.drain();

      expect(world.comparer.asked).toEqual([FIRST_DAY, FIRST_DAY]);
      const keys = (await world.messages()).map((message) => message.messageKey);
      expect(new Set(keys).size).toBe(2);
    });

    /** @scenario "A quiet day is never re-checked on its own" */
    it("never compares the day again while nothing lands on it", async () => {
      const world = watchWorld();
      await world.record(charge("item-1"));
      world.toNextSlot();
      await world.fireDueChecks();
      await world.drain();

      for (let night = 0; night < 5; night++) {
        world.toNextSlot();
        await world.fireDueChecks();
        await world.drain();
      }

      expect(world.comparer.asked).toEqual([FIRST_DAY]);
      expect(await world.dueWakes()).toEqual([]);
    });
  });

  describe("given an organization with no pulled charges at all", () => {
    /** @scenario "An organization that has never pulled a bill has nothing armed" */
    it("holds no check of its own and is never asked about", async () => {
      const world = watchWorld();
      await world.record(charge("item-1"));
      const quiet: ProcessRef = {
        ...WATCH_REF,
        projectId: "tenant-quiet",
        processKey: "tenant:tenant-quiet",
      };

      world.advance(7 * DAY_MS);
      const due = await world.dueWakes();
      await world.fireDueChecks();
      await world.drain();

      expect(await world.store.findByRef({ ref: quiet })).toBeNull();
      expect(due.map((wake) => wake.ref.projectId)).toEqual([TENANT_ID]);
      expect(await world.store.findMessagesByRef({ ref: quiet })).toEqual([]);
    });
  });

  describe("given the organization's requests through the gateway are recorded", () => {
    /** @scenario "Gateway spend does not mark a day" */
    it("listens only to pulled charges and asks only about the pulled lane", async () => {
      const pipeline = PulledUsageEventingAdapter.create({
        costRollup: rollupFold().projection,
        costRollupWatch: CostRollupWatchProcess.create(new FailingComparer()),
      }).build();
      const world = watchWorld();
      await world.record(charge("item-1"));
      world.toNextSlot();
      await world.fireDueChecks();

      const watch = pipeline.processManagers.get(COST_ROLLUP_WATCH_PROCESS_NAME);
      expect(Object.keys(watch?.config.handlers ?? {}).toSorted()).toEqual(
        [PULLED_USAGE_EVENT_TYPES.OBSERVED, PULLED_USAGE_EVENT_TYPES.RETRACTED].toSorted(),
      );
      expect(await world.messages()).toEqual([
        expect.objectContaining({ payload: expect.objectContaining({ costSource: "pulled" }) }),
      ]);
    });
  });

  describe("given a pulled charge landed just before tonight's check", () => {
    /** @scenario "A charge the summary has not folded yet is waited for rather than counted as drift" */
    it("waits for the summary, then compares once more and finds it agrees", async () => {
      const world = watchWorld();
      const late = charge("item-1");
      await world.record(late, { summarized: false });
      world.toNextSlot();
      await world.fireDueChecks();

      await world.drain(1);
      expect(driftCount()).toBe(0);
      expect((await world.messages()).map((message) => message.status)).toEqual(["pending"]);

      await world.summarize(late);
      await world.drain(1);

      expect(world.comparer.asked).toEqual([FIRST_DAY, FIRST_DAY]);
      expect((await world.messages()).map((message) => message.status)).toEqual(["dispatched"]);
      expect(driftCount()).toBe(0);
      expect(world.lines.findLine("error", "Governance cost rollup disagrees")).toBeUndefined();
    });
  });
});

describe("a failing comparison against its process store", () => {
  async function failingCheck() {
    const world = watchWorld({ failing: true });
    await world.record(charge("item-1"));
    world.toNextSlot();
    await world.fireDueChecks();
    return world;
  }

  describe("given a comparison has failed on each of its first three attempts", () => {
    /** @scenario "A comparison that has failed three times is attempted a fourth" */
    it("attempts it a fourth time", async () => {
      const world = await failingCheck();
      await world.drain(3);
      expect(world.comparer.asked).toHaveLength(3);
      expect((await world.messages()).map((message) => message.status)).toEqual(["pending"]);

      await world.drain(1);

      expect(world.comparer.asked).toHaveLength(4);
    });
  });

  describe("given a comparison has failed on each of its first five attempts", () => {
    /** @scenario "A comparison that has failed five times is not attempted again" */
    it("stops at five and records that it gave up", async () => {
      const world = await failingCheck();
      await world.drain(5);
      await world.drain(5);

      expect(world.comparer.asked).toHaveLength(5);
      const [message] = await world.messages();
      expect(message?.status).toBe("dead");
      const attempts = world.store.findFailedAttempts({
        processName: COST_ROLLUP_WATCH_PROCESS_NAME,
        projectId: TENANT_ID,
        messageKey: message?.messageKey ?? "",
      });
      expect(attempts.map((attempt) => attempt.outcome).at(-1)).toBe("dead");
    });
  });

  describe("given the comparison fails every time it is attempted", () => {
    /** @scenario "A failing comparison does not stop charges being recorded" */
    it("still records later charges and marks their days", async () => {
      const world = await failingCheck();
      await world.drain(2);

      await world.record(chargeOnSecondDay("item-2"));
      await world.drain(6);

      await expect(
        world.costCharges.findChargesForDay({
          tenantId: TENANT_ID,
          day: SECOND_DAY,
          costSource: "pulled",
        }),
      ).resolves.toHaveLength(1);
      await expect(
        world.costRollup.findCellsForDay({
          tenantId: TENANT_ID,
          day: SECOND_DAY,
          costSource: "pulled",
        }),
      ).resolves.toHaveLength(1);
      const state = await world.state();
      expect(state?.pendingDays).toEqual([SECOND_DAY]);
      expect(state?.armedAt).not.toBeNull();
    });
  });

  describe("given a comparison for a day gave up after its last attempt", () => {
    /** @scenario "A comparison that gave up is not picked up by a later check" */
    it("leaves the day alone at the next check when nothing new lands on it", async () => {
      const world = await failingCheck();
      await world.drain(8);

      world.toNextSlot();
      await world.fireDueChecks();
      await world.drain();

      expect(world.comparer.asked).toHaveLength(5);
      expect(await world.messages()).toHaveLength(1);
    });
  });
});

describe("drift that outlives the ladder", () => {
  describe("given a day's summary no longer matches its recorded charges", () => {
    /** @scenario "Drift that outlives every look is counted and logged" */
    it("counts it once and logs both figures", async () => {
      const world = await driftingWorld();
      world.toNextSlot();
      await world.fireDueChecks();
      await world.drain();

      expect(driftCount()).toBe(1);
      expect(world.lines.findLine("error", "Governance cost rollup disagrees")).toMatchObject({
        tenantId: TENANT_ID,
        day: FIRST_DAY,
        cost_source: "pulled",
        summarized_nano_minor: 1_500,
        derived_nano_minor: 1_000,
      });
      expect((await world.messages()).map((message) => message.status)).toEqual(["dispatched"]);
    });

    /** @scenario "Finding drift leaves the summary exactly as it was" */
    it("leaves the summary as it was and asks for nothing but comparisons", async () => {
      const world = await driftingWorld();
      const read = { tenantId: TENANT_ID, day: FIRST_DAY, costSource: "pulled" };
      const before = await world.costRollup.findCellsForDay(read);
      world.toNextSlot();
      await world.fireDueChecks();
      await world.drain();

      expect(await world.costRollup.findCellsForDay(read)).toEqual(before);
      expect(new Set((await world.messages()).map((message) => message.intentType))).toEqual(
        new Set(["compareDay"]),
      );
    });
  });

  describe("given a day that has already been compared", () => {
    /** @scenario "Comparing a day twice over changes nothing that is stored" */
    it("stores nothing and finds the same thing the second time", async () => {
      const world = await driftingWorld();
      const read = { tenantId: TENANT_ID, day: FIRST_DAY, costSource: "pulled" };
      const summaryBefore = await world.costRollup.findCellsForDay(read);
      const chargesBefore = await world.costCharges.findChargesForDay(read);

      const first = await world.real.compareDay({ tenantId: TENANT_ID, day: FIRST_DAY });
      const second = await world.real.compareDay({ tenantId: TENANT_ID, day: FIRST_DAY });

      expect(await world.costRollup.findCellsForDay(read)).toEqual(summaryBefore);
      expect(await world.costCharges.findChargesForDay(read)).toEqual(chargesBefore);
      const finding = ({ mismatchedCells, cellsBehind, lagMs }: CostRollupDayLook) => ({
        mismatchedCells,
        cellsBehind,
        lagMs,
      });
      expect(finding(second)).toEqual(finding(first));
      expect(first.mismatchedCells).toBe(1);
    });
  });
});

describe("a deployment and its missed checks", () => {
  describe("given a deployment where the cost summary store is not configured", () => {
    /** @scenario "A deployment that holds no summary at all asks for no comparisons" */
    it("mounts no watch, so nothing is asked and nothing gives up", () => {
      const comparer = new FailingComparer();
      const pipeline = PulledUsageEventingAdapter.create({
        costRollupWatch: CostRollupWatchProcess.create(comparer),
      }).build();

      expect(pipeline.processManagers.has(COST_ROLLUP_WATCH_PROCESS_NAME)).toBe(false);
      expect(comparer.asked).toEqual([]);
    });
  });

  describe("given a check's moment passed with nothing running to answer it", () => {
    /** @scenario "A check whose moment passed with nothing running fires once afterwards" */
    it("answers it once and compares the marked day once", async () => {
      const world = watchWorld();
      await world.record(charge("item-1"));
      world.toNextSlot();
      world.advance(3 * DAY_MS);

      expect(await world.dueWakes()).toHaveLength(1);
      await world.fireDueChecks();
      await world.drain();

      expect(world.comparer.asked).toEqual([FIRST_DAY]);
      expect(await world.messages()).toHaveLength(1);
      expect(await world.dueWakes()).toEqual([]);
    });
  });

  describe("given a check whose moment passed and which has not been answered", () => {
    /** @scenario "A check that is overdue is visible without anyone knowing to look" */
    it("is listed as due by the process store, with the moment it was due", async () => {
      const world = watchWorld();
      await world.record(charge("item-1"));
      const slot = nextCostRollupCheckAt(world.now());
      world.toNextSlot();
      world.advance(HOUR_MS);

      const due = await world.dueWakes();

      expect(due).toEqual([expect.objectContaining({ ref: WATCH_REF, wakeAt: slot })]);
      expect(slot).toBeLessThan(world.now());
    });
  });
});
