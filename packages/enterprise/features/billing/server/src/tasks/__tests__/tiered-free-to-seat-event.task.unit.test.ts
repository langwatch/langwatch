import { describe, expect, it, vi } from "vitest";
import {
  runTieredFreeToSeatEventMigration,
  TieredFreeToSeatEventMigrateTask,
  type TieredFreeToSeatEventMigrationDatabase,
} from "../tiered-free-to-seat-event.task";

function databaseWith(
  orgs: { id: string; name: string; slug: string; pricingModel: string }[],
): TieredFreeToSeatEventMigrationDatabase {
  return {
    organization: {
      findMany: vi.fn(async () => orgs),
      updateMany: vi.fn(async ({ where }) => ({ count: where.id.in.length })),
    },
  };
}

describe("runTieredFreeToSeatEventMigration", () => {
  describe("given no matching organizations", () => {
    it("reports zero found and writes nothing", async () => {
      const database = databaseWith([]);
      const outcome = await runTieredFreeToSeatEventMigration({ database, execute: true });
      expect(outcome).toEqual({ found: 0, updated: 0 });
      expect(database.organization.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("when execute is false", () => {
    it("finds the organizations but does not update them", async () => {
      const database = databaseWith([
        { id: "org_1", name: "Org", slug: "org", pricingModel: "TIERED" },
      ]);
      const outcome = await runTieredFreeToSeatEventMigration({ database, execute: false });
      expect(outcome).toEqual({ found: 1, updated: 0 });
      expect(database.organization.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("when execute is true", () => {
    it("moves every matching organization to SEAT_EVENT", async () => {
      const database = databaseWith([
        { id: "org_1", name: "Org 1", slug: "org-1", pricingModel: "TIERED" },
        { id: "org_2", name: "Org 2", slug: "org-2", pricingModel: "TIERED" },
      ]);
      const outcome = await runTieredFreeToSeatEventMigration({ database, execute: true });
      expect(outcome).toEqual({ found: 2, updated: 2 });
      expect(database.organization.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["org_1", "org_2"] }, pricingModel: "TIERED" },
        data: { pricingModel: "SEAT_EVENT" },
      });
    });
  });
});

describe("TieredFreeToSeatEventMigrateTask", () => {
  it("is named tiered-free-to-seat-event and reads --execute from args", async () => {
    const database = databaseWith([
      { id: "org_1", name: "Org", slug: "org", pricingModel: "TIERED" },
    ]);
    const task = TieredFreeToSeatEventMigrateTask.create({ database: () => database });
    expect(task.name).toBe("tiered-free-to-seat-event");

    const controller = new AbortController();
    await task.run({ args: ["--execute"], signal: controller.signal });

    expect(database.organization.updateMany).toHaveBeenCalledOnce();
  });
});
