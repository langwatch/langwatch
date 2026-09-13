// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The drift check, driven by the charges instead of by a clock.
 *
 * The definition under test is the exact one the runtime mounts, built through
 * the pipeline's own applier and driven through the real process service and
 * the real outbox dispatcher — so the marking, the arming and the wake are the
 * runtime's, not the test's.
 *
 * Every delivery goes through the definition's own `keyBy` and `toPayload`
 * rather than a hand-written envelope. Those two are the whole reason one
 * organization's charges gather on one instance instead of scattering across
 * one instance per charge, so a test that computed the key itself would prove
 * nothing about the shape that ships.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { GOVERNANCE_COST_SOURCE } from "@ee/governance/projections/governanceCostRollup.constants";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type { ProcessManagerConfig } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  InMemoryProcessStore,
  type ProcessDefinition,
  ProcessManagerService,
} from "~/server/event-sourcing/process-manager";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager/outbox/outboxDispatcherService";
import type { ProcessEventEnvelope } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";

import {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  type CostRollupWatchState,
  costRollupWatchPM,
} from "../costRollupWatch.process";

const ns = `cost-watch-${nanoid(8)}`;

/** The organization's hidden governance project — the tenant of every row. */
const TENANT = `proj-gov-${ns}`;
const OTHER_TENANT = `proj-gov-other-${ns}`;

/** An ordinary working morning, hours after that day's slot has passed. */
const NOW = Date.UTC(2026, 8, 10, 8, 0, 0);
const TODAY = "2026-09-10";
const YESTERDAY = "2026-09-09";
const LAST_TUESDAY = "2026-09-01";

/** The slot every charge recorded at `NOW` arms. */
const TONIGHT = Date.UTC(2026, 8, 11, 4, 23, 0);

let store: InMemoryProcessStore;
let service: ProcessManagerService<CostRollupWatchState>;
let dispatcher: OutboxDispatcherService;
let compareDay: ReturnType<typeof vi.fn>;
let config: ProcessManagerConfig<any, any, PulledUsageProcessingEvent>;
let clock: number;

function definition() {
  return buildProcessManager<PulledUsageProcessingEvent>({
    name: COST_ROLLUP_WATCH_PROCESS_NAME,
    applier: costRollupWatchPM({
      comparator: { compareDay } as never,
    }),
  });
}

/**
 * One charge, as the log holds it: the tenant it belongs to, the item stream
 * it arrived on, and the moment it HAPPENED.
 */
function charge({
  tenantId = TENANT,
  occurredAtMs = NOW,
  eventType = PULLED_USAGE_EVENT_TYPES.OBSERVED,
  eventId = `evt-${nanoid(10)}`,
  aggregateId = `item-${nanoid(6)}`,
}: {
  tenantId?: string;
  occurredAtMs?: unknown;
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

async function instanceOf(tenantId = TENANT) {
  return await store.findByRef<CostRollupWatchState>({
    ref: refFor(tenantId),
  });
}

async function stateOf(tenantId = TENANT): Promise<CostRollupWatchState> {
  const instance = await instanceOf(tenantId);
  if (!instance) throw new Error(`no process instance for ${tenantId}`);
  return instance.state;
}

/** Runs the armed check the way the wake worker does, at its own slot. */
async function runDueCheck(tenantId = TENANT): Promise<void> {
  const instance = await instanceOf(tenantId);
  if (!instance?.nextWakeAt) {
    throw new Error(`no check armed for ${tenantId}`);
  }
  clock = instance.nextWakeAt;
  await service.handleWake({
    wake: {
      ref: refFor(tenantId),
      revision: instance.revision,
      wakeAt: instance.nextWakeAt,
    },
    now: clock,
  });
}

async function drainOutbox(passes = 4): Promise<void> {
  for (let i = 0; i < passes; i++) {
    clock += 1_000;
    await dispatcher.runOnce({ now: clock, limit: 500 });
  }
}

beforeEach(() => {
  clock = NOW;
  compareDay = vi.fn().mockResolvedValue(undefined);
  config = definition().config as typeof config;
  store = new InMemoryProcessStore();
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
  });
});

describe("marking the day a charge happened on", () => {
  describe("given an organization with no check armed", () => {
    /** @scenario The first charge of a day marks that day and arms a check */
    it("marks the charge's own day and arms the next slot after it", async () => {
      await record(charge());

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
      expect(instance?.nextWakeAt).toBe(TONIGHT);
    });

    /** @scenario A correction that arrives before the charge it corrects still marks its day */
    it("marks an old day from a retraction that arrives first, and only once", async () => {
      await record(
        charge({
          eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
          occurredAtMs: Date.UTC(2026, 8, 1, 13, 0, 0),
        }),
      );
      await record(charge({ occurredAtMs: Date.UTC(2026, 8, 1, 9, 0, 0) }));

      expect((await stateOf()).pendingDays).toEqual([LAST_TUESDAY]);
    });
  });

  describe("given a pulled charge dated today has already been recorded", () => {
    beforeEach(async () => {
      await record(charge());
    });

    /** @scenario A second charge on the same day neither marks it twice nor moves the check */
    it("keeps one mark and leaves the armed moment alone", async () => {
      clock = NOW + 3_600_000;
      await record(charge({ occurredAtMs: NOW + 3_600_000 }));

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
      expect(instance?.nextWakeAt).toBe(TONIGHT);
    });

    /** @scenario Charges on two different days mark both and still share one check */
    it("marks both days under the one armed check", async () => {
      await record(charge({ occurredAtMs: Date.UTC(2026, 8, 9, 22, 0, 0) }));

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, YESTERDAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
    });

    /** @scenario The same charge delivered twice changes nothing */
    it("ignores a redelivery of the very same charge", async () => {
      const repeat = charge({ eventId: `evt-repeat-${ns}` });
      await record(repeat);
      const before = await instanceOf();

      await record(repeat);

      const after = await instanceOf();
      expect(after?.state.pendingDays).toEqual([TODAY]);
      expect(after?.state.armedAt).toBe(TONIGHT);
      expect(after?.revision).toBe(before?.revision);
    });
  });

  describe("given the organization's charges for last Tuesday were checked and cleared", () => {
    beforeEach(async () => {
      await record(charge({ occurredAtMs: Date.UTC(2026, 8, 1, 9, 0, 0) }));
      await runDueCheck();
    });

    /** @scenario A correction dated an old day puts that old day back on the list */
    it("puts the corrected day back on the list", async () => {
      await record(
        charge({
          eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
          occurredAtMs: Date.UTC(2026, 8, 1, 9, 0, 0),
        }),
      );

      expect((await stateOf()).pendingDays).toEqual([LAST_TUESDAY]);
    });

    /** @scenario A charge after the check arms the next one */
    it("arms the next check when a new charge lands", async () => {
      await record(charge({ occurredAtMs: clock }));

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toHaveLength(1);
      expect(instance?.state.armedAt).not.toBeNull();
      expect(instance?.nextWakeAt).not.toBeNull();
    });
  });
});

describe("choosing the moment a check is armed for", () => {
  describe("given a charge recorded a minute before the slot", () => {
    /** @scenario A charge landing a minute before the slot is checked at that slot */
    it("arms that same day's slot", async () => {
      clock = Date.UTC(2026, 8, 10, 4, 22, 0);
      await record(charge({ occurredAtMs: clock }));

      expect((await stateOf()).armedAt).toBe(Date.UTC(2026, 8, 10, 4, 23, 0));
    });
  });

  describe("given a charge recorded exactly on the slot", () => {
    /** @scenario A charge landing exactly on the slot waits for tomorrow */
    it("arms tomorrow's slot rather than one already due", async () => {
      clock = Date.UTC(2026, 8, 10, 4, 23, 0);
      await record(charge({ occurredAtMs: clock }));

      const armedAt = (await stateOf()).armedAt;
      expect(armedAt).toBe(Date.UTC(2026, 8, 11, 4, 23, 0));
      expect(armedAt).toBeGreaterThan(clock);
    });
  });

  describe("given a charge recorded just after the slot", () => {
    /** @scenario A charge landing just after the slot waits for tomorrow */
    it("arms tomorrow's slot", async () => {
      clock = Date.UTC(2026, 8, 10, 4, 24, 0);
      await record(charge({ occurredAtMs: clock }));

      expect((await stateOf()).armedAt).toBe(Date.UTC(2026, 8, 11, 4, 23, 0));
    });
  });

  describe("given a charge dated three days from now", () => {
    /** @scenario A charge dated in the future does not pull an armed check earlier */
    it("marks the future day and leaves tonight's check where it is", async () => {
      await record(charge());

      await record(charge({ occurredAtMs: NOW + 3 * 86_400_000 }));

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, "2026-09-13"]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
    });

    /** @scenario A charge dated in the future does not push the check out to that date */
    it("arms the next slot after now rather than one after the future date", async () => {
      await record(charge({ occurredAtMs: NOW + 3 * 86_400_000 }));

      const armedAt = (await stateOf()).armedAt;
      expect(armedAt).toBe(TONIGHT);
      expect(armedAt).toBeLessThan(NOW + 3 * 86_400_000);
    });
  });

  describe("given a charge carrying no usable moment", () => {
    /** @scenario A charge carrying no usable moment is refused rather than marked */
    it.each([
      ["a missing moment", undefined],
      ["a moment that is not a date", "yesterday"],
      ["a moment that is not a number", Number.NaN],
    ])("refuses %s and leaves the state as it was", async (_label, value) => {
      await record(charge());
      const before = await instanceOf();

      await record(charge({ occurredAtMs: value }));

      const after = await instanceOf();
      expect(after?.state.pendingDays).toEqual(before?.state.pendingDays);
      expect(after?.state.armedAt).toBe(TONIGHT);
      expect(after?.nextWakeAt).toBe(TONIGHT);
    });
  });
});

describe("running the check when it comes due", () => {
  describe("given two days are marked as needing a check", () => {
    beforeEach(async () => {
      await record(charge());
      await record(charge({ occurredAtMs: Date.UTC(2026, 8, 9, 22, 0, 0) }));
    });

    /** @scenario A due check asks for one comparison per marked day */
    it("asks for one comparison per marked day, naming the organization and lane", async () => {
      await runDueCheck();
      await drainOutbox();

      expect(compareDay).toHaveBeenCalledTimes(2);
      expect(compareDay.mock.calls.map(([params]) => params)).toEqual([
        {
          tenantId: TENANT,
          day: TODAY,
          costSource: GOVERNANCE_COST_SOURCE.PULLED,
        },
        {
          tenantId: TENANT,
          day: YESTERDAY,
          costSource: GOVERNANCE_COST_SOURCE.PULLED,
        },
      ]);
    });

    /** @scenario A due check clears the marks and disarms */
    it("clears the marks and leaves nothing armed", async () => {
      await runDueCheck();

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([]);
      expect(instance?.state.armedAt).toBeNull();
      expect(instance?.nextWakeAt).toBeNull();
    });
  });

  describe("given a day was compared at tonight's check", () => {
    /** @scenario A charge re-marking a day after tonight's check still gets that day compared again */
    it("compares that day a second time when a charge marks it again", async () => {
      await record(charge());
      await runDueCheck();
      await drainOutbox();
      expect(compareDay).toHaveBeenCalledTimes(1);

      // The skew this exists for: the charge carries a moment before the
      // check's own, so it arms the moment that has just gone by, yet it is
      // written after the check ran. Driven through `record` rather than
      // written into the store, so what arms it is the process's own marking.
      await record(charge({ occurredAtMs: NOW }), { now: TONIGHT - 1 });
      expect((await stateOf()).armedAt).toBe(TONIGHT);

      await runDueCheck();
      await drainOutbox();

      expect(compareDay.mock.calls.map(([params]) => params.day)).toEqual([
        TODAY,
        TODAY,
      ]);
      const cleared = await instanceOf();
      expect(cleared?.state.pendingDays).toEqual([]);
      expect(cleared?.state.armedAt).toBeNull();
      expect(cleared?.nextWakeAt).toBeNull();
    });
  });

  describe("given no days are marked as needing a check", () => {
    /** @scenario A check that comes due with nothing marked asks for no comparison */
    it("asks for no comparison", async () => {
      await store.commit({
        ref: refFor(TENANT),
        tenantId: TENANT,
        state: { pendingDays: [], armedAt: TONIGHT, marks: 0 },
        expectedRevision: 0,
        nextWakeAt: TONIGHT,
        sourceEventId: `armed-empty-${ns}`,
        messages: [],
        now: NOW,
      });

      await runDueCheck();
      await drainOutbox();

      expect(compareDay).not.toHaveBeenCalled();
    });
  });

  describe("given a source read from scratch that covers a year of bills", () => {
    /** @scenario A first import marks every day it covers and compares them at one check */
    it("marks every distinct day once and compares them all at the one check", async () => {
      const firstDay = Date.UTC(2025, 8, 11, 12, 0, 0);
      const days = 365;
      for (let offset = 0; offset < days; offset++) {
        // Two charges per day, so the day being a set is what collapses them
        // rather than there only ever having been one.
        await record(charge({ occurredAtMs: firstDay + offset * 86_400_000 }));
        await record(
          charge({ occurredAtMs: firstDay + offset * 86_400_000 + 3_600_000 }),
        );
      }

      const armed = await instanceOf();
      expect(armed?.state.pendingDays).toHaveLength(days);
      expect(new Set(armed?.state.pendingDays).size).toBe(days);
      expect(armed?.state.armedAt).toBe(TONIGHT);

      await runDueCheck();
      await drainOutbox(6);

      expect(compareDay).toHaveBeenCalledTimes(days);
    });
  });
});

describe("keeping one check per organization", () => {
  describe("given charges from two different bills of one organization", () => {
    /** @scenario Every charge of one organization feeds the same check */
    it("gathers both onto one instance with both days marked", async () => {
      await record(charge({ aggregateId: `item-a-${ns}` }));
      await record(
        charge({
          aggregateId: `item-b-${ns}`,
          occurredAtMs: Date.UTC(2026, 8, 9, 22, 0, 0),
        }),
      );

      const instance = await instanceOf();
      expect(instance?.state.pendingDays).toEqual([TODAY, YESTERDAY]);
      expect(instance?.state.armedAt).toBe(TONIGHT);
    });
  });

  describe("given two organizations that both pull their bills", () => {
    /** @scenario One organization's charges never mark another's days */
    it("leaves the other organization with nothing marked and nothing armed", async () => {
      await record(charge({ tenantId: TENANT }));

      expect(await instanceOf(OTHER_TENANT)).toBeNull();
    });
  });
});

describe("keeping marked days answerable", () => {
  describe("given any organization with at least one day marked", () => {
    /** @scenario An organization holding marked days always has a check armed */
    it("always holds a check armed alongside them", async () => {
      const moments = [
        NOW,
        Date.UTC(2026, 8, 10, 4, 23, 0),
        Date.UTC(2026, 8, 1, 9, 0, 0),
        NOW + 3 * 86_400_000,
      ];
      for (const occurredAtMs of moments) {
        clock = Math.min(occurredAtMs, NOW);
        await record(charge({ occurredAtMs }));
        const instance = await instanceOf();
        if ((instance?.state.pendingDays.length ?? 0) > 0) {
          expect(instance?.state.armedAt).not.toBeNull();
          expect(instance?.nextWakeAt).not.toBeNull();
        }
      }

      await runDueCheck();
      const cleared = await instanceOf();
      expect(cleared?.state.pendingDays).toEqual([]);
      expect(cleared?.state.armedAt).toBeNull();
    });
  });
});
