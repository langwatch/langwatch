#!/usr/bin/env node
// pnpm warns on a cyclic workspace dependency but does not fail (10.24, no
// native flag) - this is the guard pnpm doesn't provide: build the same
// graph pnpm resolves, find cycles (Tarjan SCC), and shrink-only compare
// against a committed baseline. New cycle/growth fails; shrinking or
// vanishing does not, until --update accepts it. Usage: [--json | --update]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
export const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "workspace-cycles-baseline.json",
);

export const shortName = (name) => name.replace(/^@langwatch\//, "");

/**
 * Every workspace package's name and path, exactly as pnpm resolves it -
 * asking pnpm avoids drifting from pnpm-workspace.yaml's own globs. Drops
 * the workspace root manifest itself; it is not a dependency of anything.
 */
export function listWorkspacePackages({ cwd = root } = {}) {
  const raw = execFileSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw).filter((pkg) => resolve(pkg.path) !== resolve(cwd));
}

/**
 * Each package's `workspace:`-range dependency names, read from its own
 * package.json - `pnpm list`'s resolved view doesn't distinguish a
 * `workspace:` range from any other, so we can't build edges from that.
 */
export function buildGraph(packages) {
  const graph = new Map();
  for (const pkg of packages) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(pkg.path, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const deps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    graph.set(
      pkg.name,
      new Set(
        Object.entries(deps)
          .filter(([, v]) => typeof v === "string" && v.startsWith("workspace:"))
          .map(([k]) => k),
      ),
    );
  }
  return graph;
}

/**
 * Tarjan SCCs over the workspace graph; a group of size 1 can't occur since
 * pnpm refuses a self-dependency at install time. Members sorted within
 * each group, groups sorted largest-first so failures lead with the worst.
 */
function visitSuccessors(v, graph, state) {
  for (const w of graph.get(v) ?? []) {
    if (!graph.has(w)) continue;
    if (!state.idx.has(w)) {
      strongconnect(w, graph, state);
      state.low.set(v, Math.min(state.low.get(v), state.low.get(w)));
    } else if (state.onStack.has(w)) {
      state.low.set(v, Math.min(state.low.get(v), state.idx.get(w)));
    }
  }
}

function strongconnect(v, graph, state) {
  state.idx.set(v, state.index);
  state.low.set(v, state.index);
  state.index++;
  state.stack.push(v);
  state.onStack.add(v);
  visitSuccessors(v, graph, state);
  if (state.low.get(v) === state.idx.get(v)) {
    const comp = [];
    let w;
    do {
      w = state.stack.pop();
      state.onStack.delete(w);
      comp.push(w);
    } while (w !== v);
    if (comp.length > 1) state.groups.push(comp.toSorted((a, b) => (a < b ? -1 : Number(a > b))));
  }
}

export function findCycleGroups(graph) {
  const state = {
    index: 0,
    idx: new Map(),
    low: new Map(),
    onStack: new Set(),
    stack: [],
    groups: [],
  };
  for (const v of graph.keys()) {
    if (!state.idx.has(v)) strongconnect(v, graph, state);
  }
  return state.groups.toSorted((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/**
 * One concrete edge or path inside a group, so the message names what to
 * delete rather than saying "there is a cycle". Direct mutual pair first;
 * else walks edges from the group's first member back to itself.
 */
function walkPath(start, group, set, graph) {
  const path = [start];
  const seen = new Set([start]);
  let current = start;
  for (let i = 0; i < group.length; i++) {
    const next = [...(graph.get(current) ?? [])].find((n) => set.has(n));
    if (!next || next === start) {
      if (next === start) path.push(next);
      break;
    }
    if (seen.has(next)) break;
    seen.add(next);
    path.push(next);
    current = next;
  }
  return path;
}

export function describeGroup(group, graph) {
  const set = new Set(group);
  for (const a of group) {
    for (const b of graph.get(a) ?? []) {
      if (!set.has(b)) continue;
      const reverseEdges = graph.get(b) ?? new Set();
      if (!reverseEdges.has(a)) continue;
      return `${shortName(a)} <-> ${shortName(b)}`;
    }
  }
  return walkPath(group[0], group, set, graph).map(shortName).join(" -> ");
}

/**
 * Shrink-only vs baseline: a group with no/some prior members is new/joined
 * (fail); members from >1 baseline group merged (fail); all from one group
 * is a shrink or no-change (fine) - `--update` is what accepts a shrink.
 */
export function compareToBaseline(currentGroups, baselineGroups, graph) {
  const packageToBaselineIndex = new Map();
  baselineGroups.forEach((group, i) => {
    for (const pkg of group) packageToBaselineIndex.set(pkg, i);
  });

  const violations = [];
  for (const group of currentGroups) {
    const newPackages = group.filter((pkg) => !packageToBaselineIndex.has(pkg));
    const knownIndices = new Set(
      group
        .filter((pkg) => packageToBaselineIndex.has(pkg))
        .map((pkg) => packageToBaselineIndex.get(pkg)),
    );

    if (newPackages.length === group.length) {
      violations.push({
        kind: "new-group",
        group,
        message: `NEW cycle group - none of these packages were previously in any cycle: ${describeGroup(
          group,
          graph,
        )}`,
      });
      continue;
    }
    if (newPackages.length > 0) {
      violations.push({
        kind: "package-joins-cycle",
        group,
        message: `${newPackages.map(shortName).join(", ")} joined an existing cycle (was not cyclic before): ${describeGroup(
          group,
          graph,
        )}`,
      });
      continue;
    }
    if (knownIndices.size > 1) {
      violations.push({
        kind: "groups-merged",
        group,
        message: `previously separate cycle groups merged into one - ${[...knownIndices]
          .map((i) => `[${baselineGroups[i].map(shortName).join(", ")}]`)
          .join(" + ")} -> ${describeGroup(group, graph)}`,
      });
    }
    // knownIndices.size === 1: every member of this group already belonged
    // to that one baseline group, so this group is a subset of it - a
    // shrink or no change. Nothing to report.
  }
  return violations;
}

/**
 * The one function that decides pass/fail, shared by the CLI and the tests -
 * so a test asserting on `exitCode` is asserting exactly what the CLI exits
 * with, not a re-implementation of the same decision.
 */
export function evaluate({ graph, baselineGroups }) {
  const currentGroups = findCycleGroups(graph);
  const violations = compareToBaseline(currentGroups, baselineGroups, graph);
  return { currentGroups, violations, exitCode: violations.length > 0 ? 1 : 0 };
}

function readBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE_PATH, "utf8");
  } catch (err) {
    console.error(
      `check-workspace-cycles: no baseline at ${BASELINE_PATH} (${err.code}). Run with --update to create one.`,
    );
    process.exit(1);
  }
  return JSON.parse(raw);
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const update = args.includes("--update");

  const packages = listWorkspacePackages();
  const graph = buildGraph(packages);
  const currentGroups = findCycleGroups(graph);

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ groups: currentGroups }, null, 2)}\n`);
    const totalPackages = currentGroups.reduce((n, g) => n + g.length, 0);
    console.error(
      `check-workspace-cycles: baseline updated - ${currentGroups.length} cycle group(s), ${totalPackages} package(s) total`,
    );
    process.exit(0);
  }

  const baseline = readBaseline();
  const { violations, exitCode } = evaluate({ graph, baselineGroups: baseline.groups });

  if (jsonOutput) {
    console.log(JSON.stringify({ currentGroups, violations }, null, 2));
  } else if (violations.length > 0) {
    console.error("check-workspace-cycles: FAILED - the workspace dependency graph grew a cycle\n");
    for (const v of violations) console.error(`  [${v.kind}] ${v.message}`);
    console.error(
      "\nDelete the edge named above. If the growth is genuinely intended, get it agreed first, then run" +
        " `node dev/scripts/check-workspace-cycles.mjs --update` to accept it into the baseline.",
    );
  } else {
    console.error(
      `check-workspace-cycles: ok - ${currentGroups.length} cycle group(s) against baseline, no growth`,
    );
  }

  process.exit(exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
