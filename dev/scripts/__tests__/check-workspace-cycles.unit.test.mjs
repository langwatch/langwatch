// Unit tests for the Tarjan detector and shrink-only baseline comparison.
// Most cases use an in-memory graph fixture (a Map, buildGraph's own shape)
// rather than real package.json trees, since only the SCC math and diff are
// under test. One case reads the real workspace graph and baseline, so a
// broken detector can't hide behind a stale baseline that always passes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildGraph,
  compareToBaseline,
  describeGroup,
  evaluate,
  findCycleGroups,
  listWorkspacePackages,
  root,
} from "../check-workspace-cycles.mjs";

function graphOf(edges) {
  return new Map(Object.entries(edges).map(([name, deps]) => [name, new Set(deps)]));
}

void describe("given the real workspace graph and the committed baseline", () => {
  /** @scenario "The committed baseline passes against the real workspace" */
  void it("exits zero", () => {
    const packages = listWorkspacePackages();
    const graph = buildGraph(packages);
    const baseline = JSON.parse(
      readFileSync(join(root, "dev/scripts/workspace-cycles-baseline.json"), "utf8"),
    );

    const { exitCode, violations } = evaluate({ graph, baselineGroups: baseline.groups });

    assert.equal(exitCode, 0, JSON.stringify(violations, null, 2));
  });
});

void describe("given a fixture graph with a direct mutual dependency", () => {
  const graph = graphOf({
    a: ["b"],
    b: ["a"],
    c: [],
  });

  /** @scenario "Two packages that depend on each other form one cycle group" */
  void it("finds one group holding both packages", () => {
    const groups = findCycleGroups(graph);
    assert.deepEqual(groups, [["a", "b"]]);
  });

  /** @scenario "A cycle group's failure message names the mutual edge" */
  void it("names the mutual edge, not just that a cycle exists", () => {
    assert.equal(describeGroup(["a", "b"], graph), "a <-> b");
  });
});

void describe("given a fixture graph with a longer cycle and no direct mutual pair", () => {
  const graph = graphOf({
    a: ["b"],
    b: ["c"],
    c: ["a"],
  });

  /** @scenario "A three-package cycle with no direct mutual pair still names a path" */
  void it("names a path back to the start", () => {
    assert.equal(describeGroup(["a", "b", "c"], graph), "a -> b -> c -> a");
  });
});

void describe("given a fixture graph matching today's baseline exactly", () => {
  const graph = graphOf({
    a: ["b"],
    b: ["a"],
    x: [],
  });
  const baselineGroups = [["a", "b"]];

  /** @scenario "An unchanged workspace graph passes the baseline check" */
  void it("exits zero", () => {
    assert.equal(evaluate({ graph, baselineGroups }).exitCode, 0);
  });
});

void describe("given a fixture graph where a previously acyclic package joins an existing cycle", () => {
  // baseline: only a <-> b cycle. Now c also depends on a, and a depends
  // back on c, so c is newly cyclic.
  const graph = graphOf({
    a: ["b", "c"],
    b: ["a"],
    c: ["a"],
  });
  const baselineGroups = [["a", "b"]];

  /** @scenario "A package joining an existing cycle for the first time fails the check" */
  void it("exits non-zero and names the joining package", () => {
    const { exitCode, violations } = evaluate({ graph, baselineGroups });
    assert.equal(exitCode, 1);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "package-joins-cycle");
    assert.match(violations[0].message, /\bc\b/);
  });
});

void describe("given a fixture graph with a brand new cycle group absent from the baseline", () => {
  const graph = graphOf({
    a: ["b"],
    b: ["a"],
    p: ["q"],
    q: ["p"],
  });
  const baselineGroups = [["a", "b"]];

  /** @scenario "A new cycle group with no baseline history fails the check" */
  void it("exits non-zero as a new group, not a joined package", () => {
    const { exitCode, violations } = evaluate({ graph, baselineGroups });
    assert.equal(exitCode, 1);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "new-group");
  });
});

void describe("given a fixture graph where two previously separate baseline groups merge", () => {
  // baseline: {a,b} and {p,q} are separate cycles. Now an edge from b to p
  // and from q back to a threads them into one bigger cycle.
  const graph = graphOf({
    a: ["b"],
    b: ["a", "p"],
    p: ["q"],
    q: ["p", "a"],
  });
  const baselineGroups = [
    ["a", "b"],
    ["p", "q"],
  ];

  /** @scenario "Two baseline cycle groups merging into one fails the check" */
  void it("exits non-zero as a merge of two baseline groups", () => {
    const { exitCode, violations } = evaluate({ graph, baselineGroups });
    assert.equal(exitCode, 1);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "groups-merged");
  });
});

void describe("given a fixture graph where a baseline group shrinks by one member", () => {
  // baseline: {a,b,c} all mutually cyclic. Now c no longer depends on
  // anything in the group, so only a <-> b remains.
  const graph = graphOf({
    a: ["b"],
    b: ["a"],
    c: [],
  });
  const baselineGroups = [["a", "b", "c"]];

  /** @scenario "A baseline cycle group shrinking passes without needing --update" */
  void it("exits zero", () => {
    assert.equal(evaluate({ graph, baselineGroups }).exitCode, 0);
  });
});

void describe("given a fixture graph where a baseline group disappears entirely", () => {
  const graph = graphOf({
    a: [],
    b: [],
  });
  const baselineGroups = [["a", "b"]];

  /** @scenario "A baseline cycle group disappearing entirely passes without needing --update" */
  void it("exits zero", () => {
    assert.equal(evaluate({ graph, baselineGroups }).exitCode, 0);
  });
});

void describe("given compareToBaseline directly", () => {
  /** @scenario "No current cycle groups means no violations regardless of baseline" */
  void it("returns no violations when nothing is cyclic any more", () => {
    const graph = graphOf({ a: [], b: [] });
    const violations = compareToBaseline([], [["a", "b"]], graph);
    assert.deepEqual(violations, []);
  });
});
