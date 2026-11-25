/**
 * Stock widgets label what they list by the name a person gave it: a suite, a managed prompt
 * version, a scenario or a topic, never an internal id.
 * @see modules/dashboard/specs/dashboards-v2.feature AC241, AC241b, AC241c
 */

import { describe, expect, it } from "vitest";

import { MARKED_CHART } from "../widgets/flight-deck-costs-parts.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";

function buildOf(id: string) {
  const build = CATALOGUE_WIDGET_BUILDS[id];
  if (!build) throw new Error(`no build for ${id}`);
  return { code: build.code.tsx, queries: build.queries };
}

type Marker = { x: string; at: string; label: string };
type MarkerOf = (row: Record<string, unknown>, names?: unknown) => Marker;

// The stored snippet is what the frame runs; evaluating it is the test.
const markerSource = MARKED_CHART.slice(MARKED_CHART.indexOf("const markerOf"));
// oxlint-disable-next-line no-implied-eval
const markerOf = new Function("bucketLabel", "bucketStart", `${markerSource}\nreturn markerOf;`)(
  (bucket: string) => bucket,
  (bucket: string) => bucket,
) as MarkerOf;

describe("given the Test pass rate widget", () => {
  /** @scenario "AC241 Widget labels: the test pass rate widget names each suite by its own name" */
  it("labels each bar by the suite's name, read from the suites the project keeps", () => {
    const { code, queries } = buildOf("ship-suites");

    expect(queries.suites).toContain("LEFT JOIN (");
    expect(queries.suites).toContain("FROM simulation_suites");
    expect(queries.suites).toContain("n.SimulationSuiteId = r.suite_key");
    expect(queries.suites).toContain("substring(ScenarioSetId, 13, length(ScenarioSetId) - 19)");
    expect(queries.suites).toContain("'Tests run by hand'");
    expect(queries.suites).toContain("'Untitled test suite'");
    expect(queries.suites).toContain("r.ScenarioSetId = '', 'default'");
    expect(queries.suites).toContain(") AS suite,");
    expect(code).toContain("label: row.suite,");
  });
});

describe("given a widget that names managed prompt versions", () => {
  const names = new Map([["prompt_version_9", "support-agent v4"]]);

  /** @scenario "AC241b Widget labels: a managed prompt version reads as its prompt handle and number" */
  it("marks a managed version by its handle and number, and a sent one by its value", () => {
    expect(markerOf({ kind: "prompt", name: "prompt_version_9", bucket: "Mon" }, names)).toEqual({
      x: "Mon",
      at: "Mon",
      label: "Prompt support-agent v4",
    });
    expect(markerOf({ kind: "prompt", name: "v2-beta", bucket: "Tue" }, names).label).toBe(
      "Prompt v2-beta",
    );
    // A chart that marks only models passes markerOf straight to map, so names is an index.
    expect(markerOf({ kind: "model", name: "gpt-6", bucket: "Wed" }, 0).label).toBe("Model: gpt-6");
  });

  /** @scenario "AC241b Widget labels: a managed prompt version reads as its prompt handle and number" */
  it("reads the version names beside the resolved trend and the by-customer change", () => {
    for (const id of ["ck-trend", "att-change"]) {
      const { code, queries } = buildOf(id);
      expect(queries.versions, id).toContain(
        "concat(p.PromptHandle, ' v', toString(v.VersionNumber))",
      );
      expect(code, id).toContain("new Map(versions.data.map((row) => [row.id, row.name]))");
    }
    expect(buildOf("ck-trend").code).toContain("markerOf(row, names)");
    expect(buildOf("att-change").code).toContain(
      "{versionName(last.previous)} to {versionName(last.version)}",
    );
  });
});

describe("given a scenario or a topic with no name", () => {
  /** @scenario "AC241c Widget labels: a scenario or a topic with no name reads as unnamed, never as its id" */
  it("reads as unnamed instead of its id", () => {
    for (const id of ["ship-flaky", "ship-verdict"]) {
      expect(buildOf(id).code, id).toContain('row.name || "Unnamed scenario"');
      expect(buildOf(id).code, id).not.toContain("row.name || row.scenario");
    }
    expect(buildOf("topics").code).toContain('row.topic || "Unnamed topic"');
    expect(buildOf("topics").code).not.toContain("row.topic_id");
  });
});
