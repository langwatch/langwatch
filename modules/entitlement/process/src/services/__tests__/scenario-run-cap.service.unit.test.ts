/**
 * The Free scenario run cap at the run door, on the usage page and for its fact event.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import type { Plan } from "@langwatch/entitlement-contract";
import { AGENT_TEST_SET_SUFFIX, SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import {
  DAY_MS,
  scenarioRunMeterKey,
  scenarioRunMonthOf,
} from "../../rules/scenario-run-cap.rules.ts";
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

function seedRun({
  meter,
  at,
  scenarioSetId = "checkout-suite",
}: {
  meter: MemoryBillableEventsMeterRepository;
  at: number;
  scenarioSetId?: string;
}) {
  meter.rows.push({
    organizationId: "org-1",
    tenantId: "project-1",
    eventId: `run-${meter.rows.length}`,
    eventType: STARTED,
    deduplicationKey: scenarioRunMeterKey({ key: `run-${meter.rows.length}`, scenarioSetId }),
    eventTimestamp: at,
  });
}

/** Seeds the first run at `firstRunAt`, then runs this month until it holds `runs`. */
function serviceOver({
  plan,
  runs,
  firstRunAt,
  failing = false,
}: {
  plan: Plan;
  runs: number;
  firstRunAt: number | null;
  failing?: boolean;
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
  };
  const service = ScenarioRunCapService.create({
    meter: counting,
    plans: { getActivePlan: async () => plan },
    now: () => now,
    logger: { warn: () => undefined },
  });
  return { service, reads, meter };
}

describe("ScenarioRunCapService", () => {
  /** @scenario Scenario sets are not capped */
  it("accepts a run for a new scenario set below the monthly cap after the grace", async () => {
    const { service, meter } = serviceOver({ plan: free, runs: 0, firstRunAt: now - 20 * DAY_MS });
    for (let i = 0; i < 10; i++) seedRun({ meter, at: now - 1000, scenarioSetId: `set-${i % 8}` });
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
    const counted = await service.count({
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
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).rejects.toBeInstanceOf(
      Error,
    );
  });

  /** @scenario The usage page shows the month's runs against the cap */
  it("reads the month's runs against the cap", async () => {
    const { service } = serviceOver({ plan: free, runs: 87, firstRunAt: now - 20 * DAY_MS });
    const usage = await service.usage({ organizationId: "org-1", plan: free });
    expect(usage?.message).toBe("87 of 100 runs this month");
  });

  /** @scenario The usage page says when the grace ends */
  it("says the cap starts when the grace ends", async () => {
    const { service } = serviceOver({ plan: free, runs: 3, firstRunAt: now - 3 * DAY_MS });
    const usage = await service.usage({ organizationId: "org-1", plan: free });
    expect(usage).toMatchObject({ inGrace: true });
    expect(usage?.message).toBe("No run cap for 11 more days, then 100 runs a month.");
  });

  /** @scenario A paid organization records no run notices */
  it("counts nothing for a paid organization, so no notice is recorded", async () => {
    const { service } = serviceOver({ plan: paid, runs: 500, firstRunAt: 0 });
    expect(
      await service.count({ organizationId: "org-1", month: "2026-11", occurredAt: now }),
    ).toBeNull();
  });

  /** @scenario Platform-owned runs do not use up the monthly cap */
  it("leaves platform-owned runs out of the month's count", async () => {
    const { service, meter } = serviceOver({ plan: free, runs: 99, firstRunAt: now - 20 * DAY_MS });
    for (const scenarioSetId of [`p1${AGENT_TEST_SET_SUFFIX}`, "voice-calls", "__internal__x"]) {
      seedRun({ meter, at: now - 1000, scenarioSetId });
    }
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
    const counted = await service.count({
      organizationId: "org-1",
      month: "2026-11",
      occurredAt: now,
    });
    expect(counted?.runs).toBe(99);
  });

  /** @scenario Platform-owned runs do not use up the monthly cap */
  it("does not start the grace on a platform-owned run", async () => {
    const { service, meter } = serviceOver({ plan: free, runs: 0, firstRunAt: null });
    seedRun({ meter, at: now - 20 * DAY_MS, scenarioSetId: "voice-calls" });
    const counted = await service.count({
      organizationId: "org-1",
      month: "2026-11",
      occurredAt: now,
    });
    expect(counted).toMatchObject({ runs: 0, firstRunAt: null });
  });
});
