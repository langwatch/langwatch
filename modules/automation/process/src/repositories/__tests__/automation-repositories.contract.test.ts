import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { automationRepositories } from "../automation-repositories.registry.ts";
import { MemoryAutomationRepositories } from "../memory/memory.automation.repositories.ts";

const trigger = {
  projectId: "project-1",
  name: "Nightly report",
  action: "SEND_EMAIL",
  actionParams: { to: ["someone@example.com"] },
  filters: {},
} as never;

describe("given the memory automation repositories", () => {
  it("declares a live and a memory tier", () => {
    expect(Object.keys(automationRepositories.definitions).toSorted()).toEqual(["live", "memory"]);
  });

  describe("when a trigger is written", () => {
    it("reads it back through the trigger row", async () => {
      const repositories = MemoryAutomationRepositories.create();
      const created = await repositories.triggers.create(trigger);

      const found = await repositories.triggers.findById({
        triggerId: created.id,
        projectId: "project-1",
      });

      expect(found?.name).toBe("Nightly report");
    });

    it("names it from the suppression-name row, which shares the store", async () => {
      const repositories = MemoryAutomationRepositories.create();
      const created = await repositories.triggers.create(trigger);

      const names = await repositories.names.findTriggerNames({
        projectId: "project-1",
        triggerIds: [created.id],
      });

      expect(names.get(created.id)).toBe("Nightly report");
    });

    it("counts its fires through the history row", async () => {
      const repositories = MemoryAutomationRepositories.create();
      const created = await repositories.triggers.create(trigger);
      await repositories.history.create({
        projectId: "project-1",
        triggerId: created.id,
        traceId: "trace-1",
        customGraphId: null,
        createdAt: fromDate(new Date(1_000)),
        resolvedAt: null,
      });

      const stats = await repositories.history.findAllStatsForProject({
        projectId: "project-1",
        firesSince: fromDate(new Date(0)),
      });

      expect(stats).toEqual([
        {
          triggerId: created.id,
          lastFiredAt: new Date(1_000),
          recentFireCount: 1,
          currentlyFiring: true,
        },
      ]);
    });
  });

  describe("when the usage report counts triggers", () => {
    it("counts the named projects only and dates the first", async () => {
      const repositories = MemoryAutomationRepositories.create();
      const created = await repositories.triggers.create(trigger);

      const counted = await repositories.triggers.countUsage({ projectIds: [created.projectId] });
      const elsewhere = await repositories.triggers.countUsage({ projectIds: ["another"] });

      expect(counted).toEqual({ triggers: 1, firstTriggerAt: created.createdAt.getTime() });
      expect(elsewhere).toEqual({ triggers: 0 });
    });
  });

  describe("when a send is claimed twice", () => {
    it("refuses the second claim", async () => {
      const repositories = MemoryAutomationRepositories.create();
      const claim = { triggerId: "trigger-1", traceId: "trace-1", projectId: "project-1" };

      expect(await repositories.triggers.claimSend(claim)).toBe(true);
      expect(await repositories.triggers.claimSend(claim)).toBe(false);
      expect(await repositories.triggers.isSendClaimed(claim)).toBe(true);
    });
  });
});
