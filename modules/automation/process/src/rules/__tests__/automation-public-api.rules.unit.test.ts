import {
  GraphAlertIncompleteError,
  TriggerActionImmutableError,
  TriggerGraphImmutableError,
  TriggerKindImmutableError,
  type Trigger,
} from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  assertWhatIsFixedIsUnchanged,
  createdKind,
  getNotifyingAction,
  storedRule,
  templateColumns,
} from "../automation-public-api.rules.ts";

function stored(overrides: Partial<Trigger>): Trigger {
  return {
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    customGraphId: null,
    actionParams: {},
    ...overrides,
  } as Trigger;
}

describe("templateColumns", () => {
  it("states all four columns, nulling the ones left out, only when templates are stated", () => {
    expect(templateColumns(undefined)).toEqual({});
    expect(templateColumns({ slackTemplate: "hi" })).toEqual({
      slackTemplateType: null,
      slackTemplate: "hi",
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    });
  });
});

describe("createdKind", () => {
  it("names an alert by its graph, a report by its schedule, anything else an automation", () => {
    const base = { name: "n", action: "SEND_EMAIL", actionParams: {} } as never;
    expect(createdKind({ ...(base as object), customGraphId: "g" } as never)).toBe("ALERT");
    expect(createdKind({ ...(base as object), report: {} } as never)).toBe("REPORT");
    expect(createdKind(base)).toBe("AUTOMATION");
  });
});

describe("getNotifyingAction", () => {
  it("keeps a notifying channel and refuses a writing one", () => {
    expect(getNotifyingAction("SEND_WEBHOOK")).toBe("SEND_WEBHOOK");
    expect(() => getNotifyingAction("ADD_TO_DATASET")).toThrow(GraphAlertIncompleteError);
  });
});

describe("assertWhatIsFixedIsUnchanged", () => {
  it("refuses a changed channel, a changed graph and a kind change", () => {
    const alert = stored({ triggerKind: "ALERT", customGraphId: "g1" });
    expect(() =>
      assertWhatIsFixedIsUnchanged({ stored: alert, input: { action: "SEND_WEBHOOK" } as never }),
    ).toThrow(TriggerActionImmutableError);
    expect(() =>
      assertWhatIsFixedIsUnchanged({ stored: alert, input: { customGraphId: "g2" } as never }),
    ).toThrow(TriggerGraphImmutableError);
    expect(() =>
      assertWhatIsFixedIsUnchanged({ stored: alert, input: { customGraphId: null } as never }),
    ).toThrow(TriggerKindImmutableError);
    expect(() =>
      assertWhatIsFixedIsUnchanged({ stored: stored({}), input: { report: {} } as never }),
    ).toThrow(TriggerKindImmutableError);
    expect(() =>
      assertWhatIsFixedIsUnchanged({ stored: alert, input: { customGraphId: "g1" } as never }),
    ).not.toThrow();
  });
});

describe("storedRule", () => {
  it("answers an alert's threshold fields and nothing for a trace automation", () => {
    const rule = { threshold: 5, operator: "gt", timePeriod: 15, seriesName: "p95" };
    expect(storedRule(stored({ actionParams: { ...rule, members: ["a@example.com"] } }))).toEqual(
      rule,
    );
    expect(storedRule(stored({ actionParams: { members: ["a@example.com"] } }))).toEqual({});
  });
});
