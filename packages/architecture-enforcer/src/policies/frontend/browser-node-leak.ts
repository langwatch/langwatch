import { builtinModules } from "node:module";

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

/**
 * Fails a browser-reachable package whose value-import graph reaches a Node
 * builtin; `import type`/`export type` stay erased.
 */
export function lintBrowserNodeLeaks(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return findFindings(snapshot).map((finding) => ({
    policy: "browser-node-leak",
    file: finding.file,
    line: finding.line,
    specifier: finding.specifier,
    message: `\`${finding.specifier}\` is a Node.js builtin, imported here in a file a browser-reachable package (a *-contract, *-browser or *-browser-kit package, or the Design System) can reach.`,
    allowed:
      "Move the Node-only code behind a leaf subpath export the browser never resolves — the pattern @langwatch/secrets and @langwatch/kernel use (ADR-132) — so the package's default entry stays portable.",
  }));
}
