import { PULLED_USAGE_EVENT_TYPES } from "@langwatch/enterprise-governance-contract";
import {
  buildProcessDefinition,
  buildProcessManager,
  createTenantId,
  type Event,
  InMemoryProcessStore,
  type ProcessDefinition,
  type ProcessEventEnvelope,
  ProcessManagerService,
  type ProcessRef,
} from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { CostRollupDayComparer, CostRollupDayLook } from "../../app/governance.members.ts";
import {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  type CostRollupWatchState,
  CostRollupWatchProcess,
  nextCostRollupCheckAt,
} from "../cost-rollup-watch.process.ts";
import { PulledUsageEventingAdapter } from "../pulled-usage.pipeline.ts";

const TENANT = "project-governance-1";

/** A comparer nothing in these tests calls: they drive evolution, not looks. */
class UncalledComparer implements CostRollupDayComparer {
  readonly costSource = "pulled";
  compareDay(): Promise<CostRollupDayLook> {
    return Promise.reject(new Error("uncalled"));
  }
}

function watchDefinition(): ProcessDefinition<CostRollupWatchState> {
  return buildProcessDefinition(
    buildProcessManager({
      name: COST_ROLLUP_WATCH_PROCESS_NAME,
      applier: CostRollupWatchProcess.create(new UncalledComparer()).processManager(),
    }).config,
  ) as ProcessDefinition<CostRollupWatchState>;
}

const ref: ProcessRef = {
  processName: COST_ROLLUP_WATCH_PROCESS_NAME,
  projectId: TENANT,
  processKey: `tenant:${TENANT}`,
};

/** The envelope the runtime hands `evolve`: `toPayload` has already narrowed it. */
function charge({
  eventType = PULLED_USAGE_EVENT_TYPES.OBSERVED,
  occurredAtMs,
  eventId = `charge:${String(occurredAtMs)}`,
}: {
  eventType?: string;
  occurredAtMs: number | null;
  eventId?: string;
}): ProcessEventEnvelope {
  return {
    eventId,
    eventType,
    occurredAt: occurredAtMs ?? 0,
    tenantId: TENANT,
    projectId: TENANT,
    processKey: `tenant:${TENANT}`,
    payload: { occurredAtMs },
  };
}

function record({
  state,
  occurredAtMs,
  now,
  eventType,
  eventId,
}: {
  state: CostRollupWatchState;
  occurredAtMs: number | null;
  now: number;
  eventType?: string;
  eventId?: string;
}) {
  return watchDefinition().evolve({
    previousState: state,
    ref,
    input: {
      kind: "event",
      now,
      event: charge({
        ...(eventType === undefined ? {} : { eventType }),
        occurredAtMs,
        ...(eventId === undefined ? {} : { eventId }),
      }),
    },
  });
}

function wake({ state, at, now }: { state: CostRollupWatchState; at: number; now: number }) {
  return watchDefinition().evolve({
    previousState: state,
    ref,
    input: { kind: "wake", scheduledFor: at, now },
  });
}

const initial = () => watchDefinition().initialState;

const MONDAY_NOON = Date.parse("2026-09-07T12:00:00.000Z");
const MONDAY_SLOT = Date.parse("2026-09-08T04:23:00.000Z");
const LAST_TUESDAY = Date.parse("2026-09-01T09:15:00.000Z");

describe("cost rollup watch marking", () => {
  describe("given an organization with no check armed", () => {
    /** @scenario "The first charge of a day marks that day and arms a check" */
    it("marks the charge's own day and arms the next 04:23 UTC after it", () => {
      const evolved = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });

      expect(evolved.state.pendingDays).toEqual(["2026-09-07"]);
      expect(evolved.state.armedAt).toBe(MONDAY_SLOT);
      expect(evolved.nextWakeAt).toBe(MONDAY_SLOT);
    });

    /** @scenario "An organization holding marked days always has a check armed" */
    it("never leaves a marked day without something armed to answer it", () => {
      const first = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const second = record({
        state: first.state,
        occurredAtMs: LAST_TUESDAY,
        now: MONDAY_NOON + 60_000,
        eventId: "charge:second",
      });

      for (const evolved of [first, second]) {
        expect(evolved.state.pendingDays.length).toBeGreaterThan(0);
        expect(evolved.state.armedAt).not.toBeNull();
      }
    });
  });

  describe("given a charge for that day has already been recorded", () => {
    /** @scenario "A second charge on the same day neither marks it twice nor moves the check" */
    it("leaves the day marked once and the check where it was", () => {
      const first = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      // A wall clock past the armed slot: re-arming here would push the check
      // out another night, so a busy organization would never be compared.
      const second = record({
        state: first.state,
        occurredAtMs: MONDAY_NOON + 3_600_000,
        now: MONDAY_SLOT + 60_000,
        eventId: "charge:second",
      });

      expect(second.state.pendingDays).toEqual(["2026-09-07"]);
      expect(second.state.armedAt).toBe(first.state.armedAt);
      expect(second.state.marks).toBe(first.state.marks);
    });

    /** @scenario "Charges on two different days mark both and still share one check" */
    it("marks both days against the one armed check", () => {
      const first = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const second = record({
        state: first.state,
        occurredAtMs: MONDAY_NOON - 86_400_000,
        now: MONDAY_NOON,
        eventId: "charge:yesterday",
      });

      expect(second.state.pendingDays).toEqual(["2026-09-07", "2026-09-06"]);
      expect(second.state.armedAt).toBe(first.state.armedAt);
    });
  });

  describe("given a correction arrives for a day already checked and cleared", () => {
    /** @scenario "A correction dated an old day puts that old day back on the list" */
    it("marks the corrected day again rather than the day the correction arrived", () => {
      const charged = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const cleared = wake({ state: charged.state, at: MONDAY_SLOT, now: MONDAY_SLOT });

      const corrected = record({
        state: cleared.state,
        occurredAtMs: LAST_TUESDAY,
        now: MONDAY_SLOT + 3_600_000,
        eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
        eventId: "retraction:1",
      });

      expect(corrected.state.pendingDays).toEqual(["2026-09-01"]);
      expect(corrected.state.armedAt).not.toBeNull();
    });

    /** @scenario "A correction that arrives before the charge it corrects still marks its day" */
    it("marks the day exactly once whichever of the two streams lands first", () => {
      const retracted = record({
        state: initial(),
        occurredAtMs: LAST_TUESDAY,
        now: MONDAY_NOON,
        eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
        eventId: "retraction:1",
      });
      const observed = record({
        state: retracted.state,
        occurredAtMs: LAST_TUESDAY + 60_000,
        now: MONDAY_NOON + 1_000,
        eventId: "observation:1",
      });

      expect(observed.state.pendingDays).toEqual(["2026-09-01"]);
      expect(observed.state.marks).toBe(1);
    });
  });

  describe("given the very same charge is delivered twice", () => {
    /** @scenario "The same charge delivered twice changes nothing" */
    it("leaves the day marked once and the check where it was", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const manager = new ProcessManagerService<CostRollupWatchState>({
        definition: watchDefinition(),
        store,
      });
      const envelope = charge({ occurredAtMs: MONDAY_NOON, eventId: "charge:redelivered" });

      await manager.handleEvent({ envelope, now: MONDAY_NOON });
      await manager.handleEvent({ envelope, now: MONDAY_NOON + 60_000 });

      const instance = await store.findByRef<CostRollupWatchState>({ ref });
      expect(instance?.state.pendingDays).toEqual(["2026-09-07"]);
      expect(instance?.state.marks).toBe(1);
      expect(instance?.state.armedAt).toBe(MONDAY_SLOT);
    });
  });

  describe("given a charge carrying no moment anyone can name", () => {
    /** @scenario "A charge carrying no usable moment is refused rather than marked" */
    it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
      "refuses %s and leaves the marks and the armed check alone",
      (occurredAtMs) => {
        const charged = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
        const refused = record({
          state: charged.state,
          occurredAtMs,
          now: MONDAY_NOON + 1_000,
          eventId: "charge:garbage",
        });

        expect(refused.state).toEqual(charged.state);
      },
    );
  });
});

describe("cost rollup watch arming moments", () => {
  describe("given a charge lands either side of the slot", () => {
    /** @scenario "A charge landing a minute before the slot is checked at that slot" */
    it("arms the same day's slot for a charge a minute before it", () => {
      const at = Date.parse("2026-09-08T04:22:00.000Z");
      expect(record({ state: initial(), occurredAtMs: at, now: at }).state.armedAt).toBe(
        Date.parse("2026-09-08T04:23:00.000Z"),
      );
    });

    /** @scenario "A charge landing exactly on the slot waits for tomorrow" */
    it("arms tomorrow's slot for a charge landing exactly on it", () => {
      const at = Date.parse("2026-09-08T04:23:00.000Z");
      const armedAt = record({ state: initial(), occurredAtMs: at, now: at }).state.armedAt;

      expect(armedAt).toBe(Date.parse("2026-09-09T04:23:00.000Z"));
      expect(armedAt).toBeGreaterThan(at);
    });

    /** @scenario "A charge landing just after the slot waits for tomorrow" */
    it("arms tomorrow's slot for a charge a minute after it", () => {
      const at = Date.parse("2026-09-08T04:24:00.000Z");
      expect(record({ state: initial(), occurredAtMs: at, now: at }).state.armedAt).toBe(
        Date.parse("2026-09-09T04:23:00.000Z"),
      );
    });
  });

  describe("given a charge dated in the future", () => {
    const THREE_DAYS_OUT = MONDAY_NOON + 3 * 86_400_000;

    /** @scenario "A charge dated in the future does not pull an armed check earlier" */
    it("marks the future day and leaves tonight's check where it is", () => {
      const tonight = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const future = record({
        state: tonight.state,
        occurredAtMs: THREE_DAYS_OUT,
        now: MONDAY_SLOT + 60_000,
        eventId: "charge:future",
      });

      expect(future.state.pendingDays).toContain("2026-09-10");
      expect(future.state.armedAt).toBe(MONDAY_SLOT);
    });

    /** @scenario "A charge dated in the future does not push the check out to that date" */
    it("arms the next slot after now rather than the slot after that date", () => {
      const armedAt = record({
        state: initial(),
        occurredAtMs: THREE_DAYS_OUT,
        now: MONDAY_NOON,
      }).state.armedAt;

      expect(armedAt).toBe(MONDAY_SLOT);
      expect(armedAt).toBeLessThan(nextCostRollupCheckAt(THREE_DAYS_OUT));
    });
  });
});

describe("cost rollup watch coming due", () => {
  describe("given two days are marked", () => {
    /** @scenario "A due check asks for one comparison per marked day" */
    it("asks for one comparison per day, each naming the organization, its day and the lane", () => {
      const first = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const second = record({
        state: first.state,
        occurredAtMs: MONDAY_NOON - 86_400_000,
        now: MONDAY_NOON,
        eventId: "charge:yesterday",
      });

      const due = wake({ state: second.state, at: MONDAY_SLOT, now: MONDAY_SLOT });

      expect(due.intents).toHaveLength(2);
      expect(due.intents.map((intent) => intent.payload)).toEqual([
        { tenantId: TENANT, day: "2026-09-07", costSource: "pulled" },
        { tenantId: TENANT, day: "2026-09-06", costSource: "pulled" },
      ]);
    });

    /** @scenario "A due check clears the marks and disarms" */
    it("leaves no day marked and nothing armed", () => {
      const charged = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const due = wake({ state: charged.state, at: MONDAY_SLOT, now: MONDAY_SLOT });

      expect(due.state.pendingDays).toEqual([]);
      expect(due.state.armedAt).toBeNull();
      expect(due.nextWakeAt).toBeNull();
    });
  });

  describe("given nothing is marked", () => {
    /** @scenario "A check that comes due with nothing marked asks for no comparison" */
    it("asks for no comparison", () => {
      expect(wake({ state: initial(), at: MONDAY_SLOT, now: MONDAY_SLOT }).intents).toEqual([]);
    });
  });

  describe("given a check has come due and cleared its marks", () => {
    /** @scenario "A charge after the check arms the next one" */
    it("marks the new charge's day and arms a check again", () => {
      const charged = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const cleared = wake({ state: charged.state, at: MONDAY_SLOT, now: MONDAY_SLOT });

      const after = record({
        state: cleared.state,
        occurredAtMs: MONDAY_SLOT + 3_600_000,
        now: MONDAY_SLOT + 3_600_000,
        eventId: "charge:after",
      });

      expect(after.state.pendingDays).toEqual(["2026-09-08"]);
      expect(after.state.armedAt).not.toBeNull();
    });

    /** @scenario "A charge re-marking a day after tonight's check still gets that day compared again" */
    it("asks a new question for a day marked again, at the very slot that just passed", () => {
      const charged = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const first = wake({ state: charged.state, at: MONDAY_SLOT, now: MONDAY_SLOT });

      // A clock a shade behind the worker's: the charge carries a moment
      // before the check that has already committed, so it re-arms the slot
      // that has just gone by and the check fires again at once.
      const remarked = record({
        state: first.state,
        occurredAtMs: MONDAY_NOON,
        now: MONDAY_SLOT - 1_000,
        eventId: "charge:late",
      });
      const second = wake({ state: remarked.state, at: MONDAY_SLOT, now: MONDAY_SLOT });

      expect(second.intents.map((intent) => intent.payload)).toEqual(
        first.intents.map((i) => i.payload),
      );
      expect(second.intents[0]?.messageKey).not.toBe(first.intents[0]?.messageKey);
      expect(second.state.pendingDays).toEqual([]);
    });
  });

  describe("given a source is read from scratch across a year of bills", () => {
    /** @scenario "A first import marks every day it covers and compares them at one check" */
    it("marks every distinct day once and compares them all at the one check", () => {
      const days = 365;
      let state = initial();
      for (let index = 0; index < days; index += 1) {
        // Two charges a day, so the run proves the set rather than the count.
        for (const half of [0, 1]) {
          state = record({
            state,
            occurredAtMs: MONDAY_NOON - index * 86_400_000 + half * 60_000,
            now: MONDAY_NOON,
            eventId: `import:${index}:${half}`,
          }).state;
        }
      }

      expect(state.pendingDays).toHaveLength(days);
      expect(new Set(state.pendingDays).size).toBe(days);
      expect(state.armedAt).toBe(MONDAY_SLOT);

      const due = wake({ state, at: MONDAY_SLOT, now: MONDAY_SLOT });
      expect(due.intents).toHaveLength(days);
    });
  });
});

describe("cost rollup watch instance identity", () => {
  const keyBy = buildProcessManager({
    name: COST_ROLLUP_WATCH_PROCESS_NAME,
    applier: CostRollupWatchProcess.create(new UncalledComparer()).processManager(),
  }).config.keyBy;

  function chargeEvent({ tenantId, bill }: { tenantId: string; bill: string }): Event {
    return {
      id: `event:${bill}`,
      aggregateId: bill,
      aggregateType: "pulled_usage",
      tenantId: createTenantId(tenantId),
      createdAt: MONDAY_NOON,
      occurredAt: MONDAY_NOON,
      type: PULLED_USAGE_EVENT_TYPES.OBSERVED,
      version: "2026-08-06",
      data: { occurredAtMs: MONDAY_NOON },
    };
  }

  describe("given two bills of one organization", () => {
    /** @scenario "Every charge of one organization feeds the same check" */
    it("feeds them both into the one check, with both days marked on it", () => {
      expect(keyBy?.(chargeEvent({ tenantId: TENANT, bill: "bill-1" }))).toBe(
        keyBy?.(chargeEvent({ tenantId: TENANT, bill: "bill-2" })),
      );

      const first = record({ state: initial(), occurredAtMs: MONDAY_NOON, now: MONDAY_NOON });
      const second = record({
        state: first.state,
        occurredAtMs: MONDAY_NOON - 86_400_000,
        now: MONDAY_NOON,
        eventId: "charge:bill-2",
      });
      expect(second.state.pendingDays).toHaveLength(2);
      expect(second.state.armedAt).toBe(first.state.armedAt);
    });
  });

  describe("given two organizations both pull their bills", () => {
    /** @scenario "One organization's charges never mark another's days" */
    it("keeps each organization's marks on its own instance", () => {
      expect(keyBy?.(chargeEvent({ tenantId: TENANT, bill: "bill-1" }))).not.toBe(
        keyBy?.(chargeEvent({ tenantId: "project-governance-2", bill: "bill-1" })),
      );
      // The other organization's instance is the initial one: no charge of
      // the first ever reaches it, so it holds nothing and arms nothing.
      expect(initial().pendingDays).toEqual([]);
      expect(initial().armedAt).toBeNull();
    });
  });
});

describe("cost rollup watch mounting", () => {
  describe("given a deployment that can compare but holds no cost summary", () => {
    /** @scenario "A deployment that can compare but holds no summary mounts no check" */
    it("does not mount the check at all", () => {
      const withoutSummary = PulledUsageEventingAdapter.create({}).build();
      const withSummary = PulledUsageEventingAdapter.create({
        costRollupWatch: CostRollupWatchProcess.create(new UncalledComparer()),
      }).build();

      expect(withoutSummary.processManagers.has(COST_ROLLUP_WATCH_PROCESS_NAME)).toBe(false);
      expect(withSummary.processManagers.has(COST_ROLLUP_WATCH_PROCESS_NAME)).toBe(true);
    });
  });
});
