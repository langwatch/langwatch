import { describe, expect, it } from "vitest";
import type { RouterOutputs } from "~/utils/api";
import { toActivityEntries } from "../AutomationsHistory";

type TriggerFire = RouterOutputs["automation"]["getRecentActivity"][number];
type EnhancedTrigger = RouterOutputs["automation"]["getTriggers"][number];

function makeTrigger(overrides: Partial<EnhancedTrigger>): EnhancedTrigger {
  return {
    id: "trig-1",
    name: "My automation",
    triggerKind: "AUTOMATION",
    customGraphId: null,
    ...overrides,
  } as unknown as EnhancedTrigger;
}

function makeFire(overrides: Partial<TriggerFire>): TriggerFire {
  return {
    id: "fire-1",
    triggerId: "trig-1",
    customGraphId: null,
    createdAt: new Date("2026-07-11T09:00:00Z"),
    resolvedAt: null,
    ...overrides,
  } as unknown as TriggerFire;
}

function triggersById(triggers: EnhancedTrigger[]) {
  return new Map(triggers.map((t) => [t.id, t]));
}

describe("toActivityEntries", () => {
  describe("given a trace automation fired", () => {
    it("reads as a match", () => {
      const entries = toActivityEntries({
        fires: [makeFire({})],
        triggersById: triggersById([makeTrigger({})]),
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe("fired");
      expect(entries[0]!.name).toBe("My automation");
    });
  });

  describe("given a report was sent", () => {
    it("reads as sent, not as a match", () => {
      const entries = toActivityEntries({
        fires: [
          // A report's row is stamped resolved at write time purely so it can
          // never read as an open incident — it is NOT a recovery.
          makeFire({
            resolvedAt: new Date("2026-07-11T09:00:00Z"),
          }),
        ],
        triggersById: triggersById([
          makeTrigger({ triggerKind: "REPORT", name: "Weekly digest" }),
        ]),
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe("reportSent");
    });
  });

  describe("given a graph alert opened and later recovered", () => {
    it("becomes two moments — the alert starting and the alert recovering", () => {
      const entries = toActivityEntries({
        fires: [
          makeFire({
            customGraphId: "graph-1",
            createdAt: new Date("2026-07-11T09:00:00Z"),
            resolvedAt: new Date("2026-07-11T11:00:00Z"),
          }),
        ],
        triggersById: triggersById([
          makeTrigger({ customGraphId: "graph-1", name: "Error rate" }),
        ]),
      });

      expect(entries.map((e) => e.kind)).toEqual([
        // Newest first: the recovery happened after the alert opened.
        "alertRecovered",
        "alertOpened",
      ]);
      expect(entries[0]!.at.toISOString()).toBe("2026-07-11T11:00:00.000Z");
      expect(entries[1]!.at.toISOString()).toBe("2026-07-11T09:00:00.000Z");
    });
  });

  describe("given a graph alert that is still firing", () => {
    it("shows only the moment it started", () => {
      const entries = toActivityEntries({
        fires: [makeFire({ customGraphId: "graph-1", resolvedAt: null })],
        triggersById: triggersById([
          makeTrigger({ customGraphId: "graph-1" }),
        ]),
      });
      expect(entries.map((e) => e.kind)).toEqual(["alertOpened"]);
    });
  });

  describe("when the automation behind a fire has since been deleted", () => {
    it("still shows the fire rather than quietly rewriting history", () => {
      const entries = toActivityEntries({
        fires: [makeFire({ triggerId: "gone" })],
        triggersById: triggersById([]),
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe("Deleted automation");
    });
  });

  describe("given fires from several automations", () => {
    it("orders every moment newest first", () => {
      const entries = toActivityEntries({
        fires: [
          makeFire({
            id: "a",
            createdAt: new Date("2026-07-11T08:00:00Z"),
          }),
          makeFire({
            id: "b",
            createdAt: new Date("2026-07-11T10:00:00Z"),
          }),
          makeFire({
            id: "c",
            createdAt: new Date("2026-07-11T09:00:00Z"),
          }),
        ],
        triggersById: triggersById([makeTrigger({})]),
      });
      expect(entries.map((e) => e.id)).toEqual(["b", "c", "a"]);
    });
  });
});
