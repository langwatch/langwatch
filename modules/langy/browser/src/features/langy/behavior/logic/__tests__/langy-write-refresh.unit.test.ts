/**
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 */
import { CAPABILITY_CATALOG } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import {
  LANGY_UNREFRESHED_RESOURCES,
  routersRefreshedByWrite,
  settledWriteOf,
} from "../langy-write-refresh.ts";

/** The routers a settled shell call running `command` refreshes. */
const routersOfShellCall = (command: string) =>
  settledWriteOf({
    type: "dynamic-tool",
    toolName: "bash",
    toolCallId: "call-1",
    state: "output-available",
    input: { command },
  })?.routers ?? [];

describe("routersRefreshedByWrite", () => {
  it("maps a scenario write to scenarios and suites", () => {
    expect(routersRefreshedByWrite({ resource: "scenario", verb: "create" })).toEqual([
      "scenarios",
      "suites",
    ]);
  });

  it("maps removals and updates too", () => {
    expect(routersRefreshedByWrite({ resource: "evaluator", verb: "delete" })).toEqual([
      "evaluators",
    ]);
    expect(routersRefreshedByWrite({ resource: "prompt", verb: "update" })).toContain("prompts");
  });

  it("maps a run to the lists it fills", () => {
    expect(routersRefreshedByWrite({ resource: "test-suite", verb: "run" })).toContain("scenarios");
  });

  it("refreshes experiments when a state is set", () => {
    expect(routersRefreshedByWrite({ resource: "experiment", verb: "set-state" })).toContain(
      "experiments",
    );
  });

  it("refreshes members when a member is enabled or disabled", () => {
    expect(routersRefreshedByWrite({ resource: "members", verb: "enable" })).toContain(
      "organization",
    );
    expect(routersRefreshedByWrite({ resource: "members", verb: "disable" })).toContain(
      "organization",
    );
  });

  it("refreshes triggers when one is enabled or disabled", () => {
    expect(routersRefreshedByWrite({ resource: "trigger", verb: "enable" })).toContain(
      "automation",
    );
    expect(routersRefreshedByWrite({ resource: "trigger", verb: "disable" })).toContain(
      "automation",
    );
  });

  it("refreshes dashboard widgets when a chart is placed or unplaced", () => {
    expect(routersRefreshedByWrite({ resource: "chart", verb: "place" })).toContain(
      "dashboardWidgets",
    );
    expect(routersRefreshedByWrite({ resource: "chart", verb: "unplace" })).toContain(
      "dashboardWidgets",
    );
  });

  it("refreshes for a verb that is not a known read", () => {
    expect(routersRefreshedByWrite({ resource: "trigger", verb: "test-fire" })).toEqual([
      "automation",
    ]);
  });

  it("maps nothing for a help request", () => {
    expect(
      routersRefreshedByWrite({ resource: "scenario", verb: "create", args: { help: true } }),
    ).toEqual([]);
  });

  it("maps nothing for a read", () => {
    expect(routersRefreshedByWrite({ resource: "scenario", verb: "list" })).toEqual([]);
  });

  /** @scenario "Every resource in the capability catalogue is mapped or declared unrefreshed" */
  it("covers every catalogue resource, mapped or declared unrefreshed", () => {
    const missing = Object.keys(CAPABILITY_CATALOG).filter(
      (resource) =>
        routersRefreshedByWrite({ resource, verb: "create" }).length === 0 &&
        !LANGY_UNREFRESHED_RESOURCES.has(resource),
    );
    expect(missing).toEqual([]);
  });
});

describe("settledWriteOf", () => {
  describe("when the verb names a subcommand group", () => {
    /** @scenario "A write through a subcommand group refreshes its resource's lists" */
    it("refreshes dataset records when a record is added", () => {
      expect(routersOfShellCall("langwatch dataset records add my-data --json")).toContain(
        "datasetRecord",
      );
    });

    it("refreshes the team when a member is added to it", () => {
      expect(routersOfShellCall("langwatch teams members add team-1 user-1")).toContain("team");
    });

    it("refreshes the group when a binding is added to it", () => {
      expect(routersOfShellCall("langwatch groups bindings add group-1 --role admin")).toContain(
        "group",
      );
    });

    it("refreshes prompt tags when one is assigned", () => {
      expect(routersOfShellCall("langwatch prompt tag assign my-prompt prod")).toContain(
        "promptTags",
      );
    });

    it("refreshes dashboard widgets when one is added", () => {
      expect(routersOfShellCall("langwatch dashboard widget add board-1 --chart c")).toContain(
        "dashboardWidgets",
      );
    });

    it("refreshes nothing when the group only lists", () => {
      expect(routersOfShellCall("langwatch dataset records list my-data")).toEqual([]);
      expect(routersOfShellCall("langwatch teams members list team-1")).toEqual([]);
    });
  });

  describe("when one shell call chains several invocations", () => {
    /** @scenario "Every write in a chained command refreshes its lists" */
    it("refreshes the routers of every invocation", () => {
      const routers = routersOfShellCall(
        "langwatch prompt create a --json && langwatch evaluator create b --json",
      );
      expect(routers).toContain("prompts");
      expect(routers).toContain("evaluators");
    });

    it("names each router once", () => {
      const routers = routersOfShellCall(
        "langwatch scenario create a && langwatch scenario create b",
      );
      expect(routers.toSorted()).toEqual(["scenarios", "suites"]);
    });
  });

  it("finds an invocation behind root-position globals", () => {
    expect(routersOfShellCall("lw --output json scenario create a")).toContain("scenarios");
  });

  it("reads a typed CLI call off its tool name", () => {
    const write = settledWriteOf({
      type: "tool-langwatch.evaluator.create",
      toolCallId: "call-2",
      state: "output-available",
      input: { name: "x" },
    });
    expect(write).toEqual({ callId: "call-2", routers: ["evaluators"] });
  });
});
