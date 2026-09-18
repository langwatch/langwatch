import { builtinModules } from "node:module";
import { relative } from "node:path";

import {
  baselinePath,
  type BaselineEntry,
  type BaselinePolicy,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "../../baseline.ts";
import type { ArchitectureViolation } from "../../types.ts";
import { valueImports, walkValueImportGraph } from "../../workspace/module-graph.ts";
import type { WorkspaceModuleResolver } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Guards ADR-132: a browser-reachable package (contract, browser,
 * browser-kit, Design System) whose value-import graph reaches a Node
 * builtin, however deep — a per-file rule cannot see that graph shape.
 */

const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier.replace(/^node:/, "")}`]),
);

/** A `*-contract`, `*-browser` or `*-browser-kit` package name: what a browser bundle can reach. */
const BROWSER_REACHABLE_PACKAGE = /-(?:contract|browser|browser-kit)$/;

/** Trusted portable by construction (React, browser-host only) — still walked here to prove it. */
const ALWAYS_CHECKED_PACKAGES = new Set(["@langwatch/design-system", "@langwatch/browser-host"]);

const BASELINE_FILE = "browser-node-leak-baseline.json";

function browserReachableRoots(
  resolver: WorkspaceModuleResolver,
  root: string,
): { name: string; file: string }[] {
  const dummyFile = `${root}/package.json`;
  const roots: { name: string; file: string }[] = [];

  for (const name of resolver.packages.keys()) {
    if (!BROWSER_REACHABLE_PACKAGE.test(name) && !ALWAYS_CHECKED_PACKAGES.has(name)) continue;

    const entry = resolver.resolve({ specifier: name, file: dummyFile });
    if (entry) roots.push({ name, file: entry });
  }

  return roots.toSorted((left, right) => left.name.localeCompare(right.name));
}

type Finding = { file: string; specifier: string; line?: number };

function findFindings(snapshot: WorkspaceSnapshot): Finding[] {
  const { resolver, root } = snapshot;
  const roots = browserReachableRoots(resolver, root);
  if (roots.length === 0) return [];

  const graph = walkValueImportGraph({
    roots: roots.map((entry) => entry.file),
    resolve: (options) => resolver.resolve(options),
    forbidden: ({ specifier }) => (NODE_BUILTIN_SPECIFIERS.has(specifier) ? specifier : void 0),
  });

  const findings: Finding[] = [];

  for (const [file, specifier] of graph.seeds) {
    const importRecord = valueImports({ file }).find((entry) => entry.specifier === specifier);
    findings.push({ file, specifier, line: importRecord?.line });
  }

  return findings.toSorted(
    (left, right) => left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0),
  );
}

function entryKey(root: string, finding: Finding): string {
  return `${relative(root, finding.file)}|${finding.specifier}`;
}

export const BROWSER_NODE_LEAK_BASELINE: BaselinePolicy = {
  id: "browser-node-leak",
  file: BASELINE_FILE,
  label: "Browser node leak baseline",
  keyRule: "A key is `<file, workspace-relative>|<Node builtin specifier>`.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Browser node leak baseline entry ${entry.key.split("|").join(" ")} no longer matches anything and must be removed.`,
    allowed: "Delete the row; the leak it excepted is gone.",
  }),
};

export function collectBrowserNodeLeakBaseline({
  snapshot,
  previous = [],
}: {
  snapshot: WorkspaceSnapshot;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = findFindings(snapshot).map((finding) => entryKey(snapshot.root, finding));

  return collectBaseline({ policy: BROWSER_NODE_LEAK_BASELINE, found, previous });
}

/**
 * Fails a browser-reachable package whose value-import graph reaches a Node
 * builtin; `import type`/`export type` stay erased. Baselined debt is
 * grandfathered by row, named and dated; anything new fails outright.
 */
export function lintBrowserNodeLeaks(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const policy = BROWSER_NODE_LEAK_BASELINE;
  const file = baselinePath({ root, policy });
  const baseline = readBaseline({ policy, file });

  const violations: ArchitectureViolation[] = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy, file }),
  ];

  const findings = findFindings(snapshot);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map((finding) => entryKey(root, finding)));

  for (const finding of findings) {
    if (baselined.has(entryKey(root, finding))) continue;

    violations.push({
      policy: "browser-node-leak",
      file: finding.file,
      line: finding.line,
      specifier: finding.specifier,
      message: `\`${finding.specifier}\` is a Node.js builtin, imported here in a file a browser-reachable package (a *-contract, *-browser or *-browser-kit package, or the Design System) can reach.`,
      allowed:
        "Move the Node-only code behind a leaf subpath export the browser never resolves — the pattern @langwatch/secrets and @langwatch/kernel use (ADR-132) — so the package's default entry stays portable.",
    });
  }

  violations.push(...staleRows({ entries: baseline.entries, found, policy, file }));

  return violations;
}
