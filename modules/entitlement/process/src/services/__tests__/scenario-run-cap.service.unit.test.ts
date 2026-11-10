/**
 * The Free scenario run cap at the run door, on the usage page and for its fact event.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import type { Plan } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import { DAY_MS } from "../../rules/scenario-run-cap.rules.ts";
import { ScenarioRunCapService } from "../scenario-run-cap.service.ts";

const now = Date.UTC(2026, 10, 20, 12);
const free = { name: "free", maxScenarioRunsPerMonth: 100, scenarioRunGraceDays: 14 } as Plan;
const paid = { name: "growth", overrideAddingLimitations: true } as Plan;

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
  const reads: string[] = [];
  const service = ScenarioRunCapService.create({
    meter: {
      countEventType: async () => {
        reads.push("count");
        if (failing) throw new Error("meter down");
        return runs;
      },
      findFirstEventAt: async () => {
        reads.push("first");
        if (failing) throw new Error("meter down");
        return firstRunAt;
      },
    } as never,
    plans: { getActivePlan: async () => plan },
    now: () => now,
    logger: { warn: () => undefined },
  });
  return { service, reads };
}

describe("ScenarioRunCapService", () => {
  /** @scenario Scenario sets are not capped */
  it("accepts a run for a new scenario set below the monthly cap after the grace", async () => {
    const { service } = serviceOver({ plan: free, runs: 10, firstRunAt: now - 20 * DAY_MS });
    await expect(service.assertRunAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
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
});
