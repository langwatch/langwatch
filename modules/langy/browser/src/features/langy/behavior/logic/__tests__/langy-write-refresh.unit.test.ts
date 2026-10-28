/**
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 */
import { CAPABILITY_CATALOG } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LANGY_UNREFRESHED_RESOURCES, routersRefreshedByWrite } from "../langy-write-refresh.ts";

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
