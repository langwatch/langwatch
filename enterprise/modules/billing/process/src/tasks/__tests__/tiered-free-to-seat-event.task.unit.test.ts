/**
 * @see enterprise/modules/billing/specs/billing.feature
 */
import { describe, expect, it } from "vitest";

import {
  runTieredFreeToSeatEventMigration,
  TieredFreeToSeatEventMigrateTask,
  type TieredFreeToSeatEventMigrationFacts,
  type TieredFreeToSeatEventMigrationPeers,
} from "../tiered-free-to-seat-event.task.ts";

type Org = { id: string; pricingModel: string; subscribed: boolean };

/** Organisations paged by id cursor as the share pages them, recording each cursor asked for. */
function peersWith(orgs: Org[]) {
  const pages: (string | undefined)[] = [];
  const sorted = orgs.toSorted((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(sorted.map((org) => [org.id, org]));
  const peers: TieredFreeToSeatEventMigrationPeers = {
    organizations: {
      listIds: async ({ after, limit = sorted.length } = {}) => {
        pages.push(after);
        const rest = sorted.filter((org) => after === undefined || org.id > after);
        const ids = rest.slice(0, limit).map((org) => org.id);
        return { ids, next: rest.length > limit ? (ids.at(-1) ?? null) : null };
      },
      findPricingModel: async (id) => byId.get(id)?.pricingModel ?? null,
    },
    subscriptions: {
      hasAnyForOrganization: async (id) => byId.get(id)?.subscribed ?? false,
    },
  };
  return { peers, pages };
}

function factsRecorder() {
  const recorded: { organizationId: string; pricingModel: string }[] = [];
  const facts: TieredFreeToSeatEventMigrationFacts = {
    pricingModelChanged: async (input) => void recorded.push(input),
  };
  return { facts, recorded };
}

const org = (id: string, overrides: Partial<Org> = {}): Org => ({
  id,
  pricingModel: "TIERED",
  subscribed: false,
  ...overrides,
});

describe("runTieredFreeToSeatEventMigration", () => {
  describe("given no matching organizations", () => {
    it("reports zero found and records nothing", async () => {
      const { peers } = peersWith([]);
      const { facts, recorded } = factsRecorder();
      const outcome = await runTieredFreeToSeatEventMigration({ peers, facts, execute: true });
      expect(outcome).toEqual({ found: 0, updated: 0 });
      expect(recorded).toEqual([]);
    });
  });

  describe("when execute is false", () => {
    it("finds the organizations but records nothing", async () => {
      const { peers } = peersWith([org("org_1")]);
      const { facts, recorded } = factsRecorder();
      const outcome = await runTieredFreeToSeatEventMigration({ peers, facts, execute: false });
      expect(outcome).toEqual({ found: 1, updated: 0 });
      expect(recorded).toEqual([]);
    });
  });

  describe("when execute is true over more than one page", () => {
    /** @scenario "The tiered free-plan move records a pricing-model fact for each organisation it moves" */
    it("records one SEAT_EVENT fact per organisation, paging by id", async () => {
      const { peers, pages } = peersWith([org("org_3"), org("org_1"), org("org_2")]);
      const { facts, recorded } = factsRecorder();
      const outcome = await runTieredFreeToSeatEventMigration({
        peers,
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

  describe("when organisations are on SEAT_EVENT or hold any subscription", () => {
    it("skips them across pages", async () => {
      const { peers, pages } = peersWith([
        org("org_1", { pricingModel: "SEAT_EVENT" }),
        org("org_2", { subscribed: true }),
        org("org_3"),
      ]);
      const { facts, recorded } = factsRecorder();
      const outcome = await runTieredFreeToSeatEventMigration({
        peers,
        facts,
        execute: true,
        pageSize: 1,
      });
      expect(outcome).toEqual({ found: 1, updated: 1 });
      expect(pages).toEqual([undefined, "org_1", "org_2"]);
      expect(recorded).toEqual([{ organizationId: "org_3", pricingModel: "SEAT_EVENT" }]);
    });
  });
});

describe("TieredFreeToSeatEventMigrateTask", () => {
  it("is named tiered-free-to-seat-event and reads --execute from args", async () => {
    const { peers } = peersWith([org("org_1")]);
    const { facts, recorded } = factsRecorder();
    const task = TieredFreeToSeatEventMigrateTask.create({ peers, facts });
    expect(task.name).toBe("tiered-free-to-seat-event");

    await task.run({ args: ["--execute"], signal: new AbortController().signal });

    expect(recorded).toHaveLength(1);
  });
});
