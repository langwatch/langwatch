/**
 * @see enterprise/modules/billing/specs/billing.feature
 */
import { describe, expect, it } from "vitest";

import {
  runTieredFreeToSeatEventMigration,
  TieredFreeToSeatEventMigrateTask,
  type TieredFreeToSeatEventMigrationDatabase,
  type TieredFreeToSeatEventMigrationFacts,
} from "../tiered-free-to-seat-event.task.ts";

type Org = { id: string; name: string; slug: string };

/** A TIERED, subscription-less table paged by id, recording every page it was asked for. */
function databaseWith(orgs: Org[]) {
  const pages: (string | undefined)[] = [];
  const database: TieredFreeToSeatEventMigrationDatabase = {
    organization: {
      findMany: async ({ where, take }) => {
        pages.push(where.id?.gt);
        return orgs
          .toSorted((a, b) => a.id.localeCompare(b.id))
          .filter((org) => !where.id || org.id > where.id.gt)
          .slice(0, take);
      },
    },
  };
  return { database, pages };
}

function factsRecorder() {
  const recorded: { organizationId: string; pricingModel: string }[] = [];
  const facts: TieredFreeToSeatEventMigrationFacts = {
    pricingModelChanged: async (input) => void recorded.push(input),
  };
  return { facts, recorded };
}

const org = (id: string): Org => ({ id, name: id, slug: id });

describe("runTieredFreeToSeatEventMigration", () => {
  describe("given no matching organizations", () => {
    it("reports zero found and records nothing", async () => {
      const { database } = databaseWith([]);
      const { facts, recorded } = factsRecorder();
      const outcome = await runTieredFreeToSeatEventMigration({ database, facts, execute: true });
      expect(outcome).toEqual({ found: 0, updated: 0 });
      expect(recorded).toEqual([]);
    });
  });

  describe("when execute is false", () => {
    it("finds the organizations but records nothing", async () => {
      const { database } = databaseWith([org("org_1")]);
      const { facts, recorded } = factsRecorder();
      const outcome = await runTieredFreeToSeatEventMigration({ database, facts, execute: false });
      expect(outcome).toEqual({ found: 1, updated: 0 });
      expect(recorded).toEqual([]);
    });
  });

  describe("when execute is true over more than one page", () => {
    /** @scenario "The tiered free-plan move records a pricing-model fact for each organisation it moves" */
    it("records one SEAT_EVENT fact per organisation, paging by id", async () => {
      const { database, pages } = databaseWith([org("org_3"), org("org_1"), org("org_2")]);
      const { facts, recorded } = factsRecorder();
      const outcome = await runTieredFreeToSeatEventMigration({
        database,
        facts,
        execute: true,
        pageSize: 2,
      });
      expect(outcome).toEqual({ found: 3, updated: 3 });
      expect(pages).toEqual([undefined, "org_2"]);
      expect(recorded).toEqual([
        { organizationId: "org_1", pricingModel: "SEAT_EVENT" },
        { organizationId: "org_2", pricingModel: "SEAT_EVENT" },
        { organizationId: "org_3", pricingModel: "SEAT_EVENT" },
      ]);
    });
  });
});

describe("TieredFreeToSeatEventMigrateTask", () => {
  it("is named tiered-free-to-seat-event and reads --execute from args", async () => {
    const { database } = databaseWith([org("org_1")]);
    const { facts, recorded } = factsRecorder();
    const task = TieredFreeToSeatEventMigrateTask.create({ database: () => database, facts });
    expect(task.name).toBe("tiered-free-to-seat-event");

    await task.run({ args: ["--execute"], signal: new AbortController().signal });

    expect(recorded).toHaveLength(1);
  });
});
