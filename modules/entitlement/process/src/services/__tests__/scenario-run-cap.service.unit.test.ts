/**
 * The Free scenario run cap at the run door, on the usage page and for its fact event.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import type { Plan } from "@langwatch/entitlement-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { DAY_MS, scenarioRunMonthOf } from "../../rules/scenario-run-cap.rules.ts";
import { ScenarioRunCapService } from "../scenario-run-cap.service.ts";

const now = Date.UTC(2026, 10, 20, 12);
const free = { name: "free", maxScenarioRunsPerMonth: 100, scenarioRunGraceDays: 14 } as Plan;
const paid = { name: "growth", overrideAddingLimitations: true } as Plan;

const STARTED = SIMULATION_RUN_EVENT_TYPES.STARTED;

class UnreachableMeter extends MemoryBillableEventsMeterRepository {
  override async countEventType(): Promise<never> {
    throw new Error("meter down");
  }
  override async findFirstEventAt(): Promise<never> {
    throw new Error("meter down");
  }
}

function seedRun({ meter, at }: { meter: MemoryBillableEventsMeterRepository; at: number }) {
  meter.rows.push({
    organizationId: "org-1",
    tenantId: "project-1",
    eventId: `run-${meter.rows.length}`,
    eventType: STARTED,
    deduplicationKey: `run-${meter.rows.length}`,
    eventTimestamp: at,
  });
}

/** Seeds the first run at `firstRunAt`, then runs this month until it holds `runs`. */
function serviceOver({
  plan,
  runs,
  firstRunAt,
  failing = false,
  clock = () => now,
}: {
  plan: Plan;
  runs: number;
  firstRunAt: number | null;
  failing?: boolean;
  clock?: () => number;
}) {
  const meter = failing ? new UnreachableMeter() : MemoryBillableEventsMeterRepository.create();
  const { startDate } = scenarioRunMonthOf(now);
  const monthStart = Temporal.Instant.from(`${startDate.replace(" ", "T")}Z`).epochMilliseconds;
  if (firstRunAt !== null) seedRun({ meter, at: firstRunAt });
  const seededInMonth = firstRunAt !== null && firstRunAt >= monthStart ? 1 : 0;
  for (let i = seededInMonth; i < runs; i++) seedRun({ meter, at: now - 1000 });
  const reads: string[] = [];
  const counting = {
    countEventType: (input: Parameters<typeof meter.countEventType>[0]) => {
      reads.push("count");
      return meter.countEventType(input);
    },
    findFirstEventAt: (input: Parameters<typeof meter.findFirstEventAt>[0]) => {
      reads.push("first");
      return meter.findFirstEventAt(input);
    },
    hasDeduplicationKey: (input: Parameters<typeof meter.hasDeduplicationKey>[0]) =>
      meter.hasDeduplicationKey(input),
    findDeduplicationKeys: (input: Parameters<typeof meter.findDeduplicationKeys>[0]) =>
      meter.findDeduplicationKeys(input),
  };
  const service = ScenarioRunCapService.create({
    meter: counting,
    plans: { getActivePlan: async () => plan },
    now: clock,
    logger: { error: () => undefined },
  });
  return { service, reads, meter };
}

describe("ScenarioRunCapService", () => {
  /** @scenario The run cap counts runs, not scenario sets */
  it("accepts a run below the monthly cap after the grace and counts runs only", async () => {
    const { service, meter } = serviceOver({ plan: free, runs: 0, firstRunAt: now - 20 * DAY_MS });
    for (let i = 0; i < 10; i++) seedRun({ meter, at: now - 1000 });
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
    const counted = await service.computeMonthCount({
      organizationId: "org-1",
      month: "2026-11",
      occurredAt: now,
    });
    expect(counted?.runs).toBe(10);
  });

  /** @scenario An unknown run count does not block runs */
  it("accepts the run when the meter cannot be read", async () => {
    const { service } = serviceOver({ plan: free, runs: 0, firstRunAt: null, failing: true });
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
  });

  /** @scenario A paid cloud plan has no run cap */
  it("accepts a paid plan's run without reading the meter", async () => {
    const { service, reads } = serviceOver({ plan: paid, runs: 5000, firstRunAt: 0 });
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("refuses the 101st run after the grace", async () => {
    const { service } = serviceOver({ plan: free, runs: 100, firstRunAt: now - 20 * DAY_MS });
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).rejects.toMatchObject({
      code: "resource_limit_exceeded",
      meta: { limitType: "scenarioRuns", current: 100, max: 100 },
    });
  });

  /** @scenario The usage page shows the month's runs against the cap */
  it("reads the month's runs against the cap", async () => {
    const { service } = serviceOver({ plan: free, runs: 87, firstRunAt: now - 20 * DAY_MS });
    const usage = await service.computeUsage({ organizationId: "org-1", plan: free });
    expect(usage?.message).toBe("87 of 100 runs this month");
  });

  /** @scenario The usage page says when the grace ends */
  it("says the cap starts when the grace ends", async () => {
    const { service } = serviceOver({ plan: free, runs: 3, firstRunAt: now - 3 * DAY_MS });
    const usage = await service.computeUsage({ organizationId: "org-1", plan: free });
    expect(usage).toMatchObject({ inGrace: true });
    expect(usage?.message).toBe("No run cap for 11 more days, then 100 runs a month.");
  });

  /** @scenario A paid organization records no run notices */
  it("counts nothing for a paid organization, so no notice is recorded", async () => {
    const { service } = serviceOver({ plan: paid, runs: 500, firstRunAt: 0 });
    expect(
      await service.computeMonthCount({
        organizationId: "org-1",
        month: "2026-11",
        occurredAt: now,
      }),
    ).toBeUndefined();
  });

  /** @scenario A run queued from the app is counted once */
  it("passes run 100 at queue time and at its start, then refuses run 101 once", async () => {
    const { service } = serviceOver({ plan: free, runs: 99, firstRunAt: now - 20 * DAY_MS });
    const ask = { organizationId: "org-1", shouldCountRun: false };
    await expect(service.assertRunAllowed(ask)).resolves.toBeUndefined();
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
    await expect(service.assertRunAllowed(ask)).rejects.toMatchObject({
      meta: { limitType: "scenarioRuns", current: 100, max: 100 },
    });
  });

  /** @scenario A retried run start is counted once */
  it("counts a run admitted under the same run key once, however often its start arrives", async () => {
    const { service } = serviceOver({ plan: free, runs: 98, firstRunAt: now - 20 * DAY_MS });
    const runKey = (id: string) => ({ projectId: "project-1", deduplicationKey: `key-${id}` });
    await service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("a") });
    await service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("a") });
    await expect(
      service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("b") }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("c") }),
    ).rejects.toMatchObject({ meta: { limitType: "scenarioRuns", current: 100, max: 100 } });
    await expect(
      service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("a") }),
    ).resolves.toBeUndefined();
  });

  /** @scenario A retried run start is counted once */
  it("passes a start already metered under its run key at the cap without counting it", async () => {
    const { service, meter } = serviceOver({
      plan: free,
      runs: 100,
      firstRunAt: now - 20 * DAY_MS,
    });
    const metered = meter.rows.at(-1)!;
    const runKey = { projectId: metered.tenantId, deduplicationKey: metered.deduplicationKey };
    await expect(
      service.assertRunAllowed({ organizationId: "org-1", runKey }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertRunAllowed({
        organizationId: "org-1",
        runKey: { projectId: "project-1", deduplicationKey: "new-run" },
      }),
    ).rejects.toMatchObject({ meta: { limitType: "scenarioRuns", current: 100, max: 100 } });
  });

  /** @scenario A queued run that never starts frees its slot */
  it("frees the slot of a run admitted at queue time whose start never reaches the meter", async () => {
    let at = now;
    const { service } = serviceOver({
      plan: free,
      runs: 99,
      firstRunAt: now - 20 * DAY_MS,
      clock: () => at,
    });
    const runKey = (id: string) => ({ projectId: "project-1", deduplicationKey: `key-${id}` });
    await service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("failed") });
    await expect(
      service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("next") }),
    ).rejects.toMatchObject({ meta: { current: 100, max: 100 } });

    at = now + 11 * 60_000;

    await expect(
      service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("next") }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertRunAllowed({ organizationId: "org-1", runKey: runKey("failed") }),
    ).rejects.toMatchObject({
      code: "resource_limit_exceeded",
      meta: { limitType: "scenarioRuns", current: 100, max: 100 },
    });
  });

  /** @scenario A retried run start is counted once */
  it("does not count a run twice once its start reaches the meter", async () => {
    let at = now;
    const { service, meter } = serviceOver({
      plan: free,
      runs: 98,
      firstRunAt: now - 20 * DAY_MS,
      clock: () => at,
    });
    const runKey = { projectId: "project-1", deduplicationKey: "key-started" };
    await service.assertRunAllowed({ organizationId: "org-1", runKey });
    meter.rows.push({
      organizationId: "org-1",
      tenantId: "project-1",
      eventId: "evt-started",
      eventType: STARTED,
      deduplicationKey: "key-started",
      eventTimestamp: now,
    });

    at = now + 31_000;

    await expect(
      service.assertRunAllowed({
        organizationId: "org-1",
        runKey: { projectId: "project-1", deduplicationKey: "key-last" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertRunAllowed({
        organizationId: "org-1",
        runKey: { projectId: "project-1", deduplicationKey: "key-over" },
      }),
    ).rejects.toMatchObject({ meta: { current: 100, max: 100 } });
  });
});
