import { describe, expect, it } from "vitest";
import {
  toAutomationActivityEntries,
  type AutomationActivityFire,
  type AutomationActivityTrigger,
} from "../ui/elements/automation-history";

function makeTrigger(overrides: Partial<AutomationActivityTrigger>): AutomationActivityTrigger {
  return {
    id: "trig-1",
    name: "My automation",
    triggerKind: "AUTOMATION",
    ...overrides,
  };
}

function makeFire(overrides: Partial<AutomationActivityFire>): AutomationActivityFire {
  return {
    id: "fire-1",
    triggerId: "trig-1",
    customGraphId: null,
    createdAt: new Date("2026-07-11T09:00:00Z"),
    resolvedAt: null,
    ...overrides,
  };
}

function triggersById(triggers: AutomationActivityTrigger[]) {
  return new Map(triggers.map((trigger) => [trigger.id, trigger]));
}

describe("toAutomationActivityEntries", () => {
  it("labels trace matches, reports, and alert recoveries without losing deleted automations", () => {
    const entries = toAutomationActivityEntries({
      fires: [
        makeFire({ id: "trace", createdAt: new Date("2026-07-11T08:00:00Z") }),
        makeFire({
          id: "report",
          triggerId: "report-trigger",
          createdAt: new Date("2026-07-11T09:00:00Z"),
          resolvedAt: new Date("2026-07-11T09:00:00Z"),
        }),
        makeFire({
          id: "alert",
          triggerId: "alert-trigger",
          customGraphId: "graph-1",
          createdAt: new Date("2026-07-11T10:00:00Z"),
          resolvedAt: new Date("2026-07-11T11:00:00Z"),
        }),
        makeFire({ id: "deleted", triggerId: "gone" }),
      ],
      triggersById: triggersById([
        makeTrigger({}),
        makeTrigger({
          id: "report-trigger",
          triggerKind: "REPORT",
          name: "Weekly digest",
        }),
        makeTrigger({ id: "alert-trigger", name: "Error rate" }),
      ]),
    });

    expect(entries.map((entry) => [entry.id, entry.kind, entry.name])).toEqual([
      ["alert:resolved", "alertRecovered", "Error rate"],
      ["alert", "alertOpened", "Error rate"],
      ["report", "reportSent", "Weekly digest"],
      ["deleted", "fired", "Deleted automation"],
      ["trace", "fired", "My automation"],
    ]);
    expect(entries[0]?.at.toISOString()).toBe("2026-07-11T11:00:00.000Z");
    expect(entries[1]?.at.toISOString()).toBe("2026-07-11T10:00:00.000Z");
  });

  it("keeps an unresolved graph alert as its opening moment only", () => {
    const entries = toAutomationActivityEntries({
      fires: [makeFire({ customGraphId: "graph-1" })],
      triggersById: triggersById([makeTrigger({})]),
    });

    expect(entries.map((entry) => entry.kind)).toEqual(["alertOpened"]);
  });
});
