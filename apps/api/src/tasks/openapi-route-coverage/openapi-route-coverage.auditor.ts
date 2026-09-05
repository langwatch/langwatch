/**
 * Route-coverage audit for the REST surface this process mounts: does every
 * mounted route reach the generated OpenAPI document at all?
 */

// A route is documented, in `UNPUBLISHED` with a written reason, or accounted
// for by its own shape (a 410 tombstone, a namespace guard). The list is
// ratcheted: an entry matching nothing is itself a failure, so it cannot
// outlive the routes it was written for.
// See `packages/api/specs/openapi-route-coverage.feature`.

import type { Exclusion } from "./openapi-route-coverage.exclusions";

/** One route the composed process mounts, as the audit reads it. */
export interface CoverageRoute {
  /** `METHOD /path/{template}` as the document would spell it. */
  key: string;
  /** The REST family that registered it. */
  family: string;
  /**
   * True when the document already describes this path under some other
   * method. The family therefore reaches the generator, and what is missing is
   * this one operation's own description rather than the whole mount.
   */
  pathDescribed: boolean;
  /** Present when the route is a `withdraw(...)` 410 tombstone. */
  withdrawn?: boolean;
  /** Present when the route is a version-namespace 404 guard. */
  namespaceGuard?: boolean;
}

/** Does this exclusion cover that operation key? */
export function excludes({ exclusion, key }: { exclusion: Exclusion; key: string }): boolean {
  if (!exclusion.match.startsWith("/")) return exclusion.match === key;
  const path = key.slice(key.indexOf(" ") + 1);
  return path === exclusion.match || path.startsWith(`${exclusion.match}/`);
}

export interface CoverageResult {
  /** Mounted, undocumented, and excused by nothing. */
  unexplained: CoverageRoute[];
  // Accounted for by the route's own shape: a 410 tombstone with no handler,
  // or a namespace guard that exists to 404. Neither can be published, so an
  // UNPUBLISHED entry for one excuses nothing and is reported stale; this
  // bucket accounts for them, and stays visible so a tombstone left behind is
  // not silently free.
  undocumentable: CoverageRoute[];
  /** Documented operations no mounted route answers. */
  orphaned: string[];
  /** Entries that excused no undocumented route, so they have to go. */
  stale: Exclusion[];
  documented: number;
  mounted: number;
}

/** Whether a route's own shape already says it can never be published. */
function accountedForByShape(route: CoverageRoute): boolean {
  return route.withdrawn === true || route.namespaceGuard === true;
}

export function auditCoverage({
  routes,
  documented,
  exclusions,
}: {
  routes: CoverageRoute[];
  documented: Set<string>;
  exclusions: readonly Exclusion[];
}): CoverageResult {
  const byKey = new Map<string, CoverageRoute>();
  for (const route of routes) {
    // A key mounted more than once resolves to its last registration, as a
    // whole record: an early version registers the route and a later one
    // withdraws it, and both the withdrawal and the diagnostic have to read
    // the later shape.
    byKey.set(route.key, route);
  }

  const answers = (operation: string): boolean => {
    const path = operation.slice(operation.indexOf(" ") + 1);
    return byKey.has(operation) || byKey.has(`ALL ${path}`);
  };

  const missing = [...byKey.values()].filter((route) => !documented.has(route.key));
  const publishable = missing.filter((route) => !accountedForByShape(route));

  const used = new Set<Exclusion>();
  const unexcused = publishable.filter((route) => {
    const excusing = exclusions.filter((exclusion) => excludes({ exclusion, key: route.key }));
    for (const exclusion of excusing) used.add(exclusion);
    return excusing.length === 0;
  });

  const byKeyOrder = (a: CoverageRoute, b: CoverageRoute) => a.key.localeCompare(b.key);

  return {
    unexplained: unexcused.sort(byKeyOrder),
    undocumentable: missing.filter(accountedForByShape).sort(byKeyOrder),
    orphaned: [...documented].filter((operation) => !answers(operation)).sort(),
    stale: exclusions.filter((exclusion) => !used.has(exclusion)),
    documented: byKey.size - missing.length,
    mounted: byKey.size,
  };
}

/** Which publishing step a route skipped. */
function publishingStepMissing(route: CoverageRoute): string {
  return route.pathDescribed
    ? "the path is described, so this method carries no describeRoute (or no output/description in its endpoint config)"
    : "no operation on this path at all, so nothing in the family describes it";
}

/** Why each route reached the report, and which publishing step it skipped. */
function formatUnexplained(routes: CoverageRoute[]): string[] {
  if (routes.length === 0) return [];

  const lines = [
    `${routes.length} mounted route${routes.length === 1 ? " is" : "s are"} missing from the OpenAPI document with no reason on record:`,
    "",
  ];

  for (const route of routes) {
    lines.push(`  ${route.key}`);
    lines.push(`    family ${route.family} (${publishingStepMissing(route)})`);
  }

  lines.push(
    "",
    "Publish it: describe the operation — describeRoute({...}) on the handler,",
    "or output/description in the endpoint config of a versioned family — then",
    "run `pnpm --filter @langwatch/platform-api task openapi-route-coverage`.",
    "",
    "Or record why it stays unpublished, in UNPUBLISHED in",
    "src/tasks/openapi-route-coverage/openapi-route-coverage.exclusions.ts.",
  );

  return lines;
}

/** Operations the document describes that this process answers nowhere. */
function formatOrphaned(operations: string[]): string[] {
  if (operations.length === 0) return [];

  return [
    `${operations.length} documented operation${operations.length === 1 ? "" : "s"} matches no mounted route:`,
    "",
    ...operations.map((operation) => `  ${operation}`),
    "",
    "The documented path and the route path have to agree — check how the",
    "route spells its parameters, and whether the family is still mounted.",
  ];
}

/** Entries that excused nothing, with the reason they are no longer earning. */
function formatStale(exclusions: Exclusion[]): string[] {
  if (exclusions.length === 0) return [];

  const lines = [
    `${exclusions.length} UNPUBLISHED entr${exclusions.length === 1 ? "y excuses" : "ies excuse"} nothing and must be deleted:`,
    "",
  ];

  for (const exclusion of exclusions) {
    lines.push(`  ${exclusion.match} [${exclusion.category}]`);
    lines.push(`    was excused because: ${exclusion.why}`);
  }

  return lines;
}

/** Whether this result fails the run. */
export function coverageFailed(result: CoverageResult): boolean {
  return result.unexplained.length > 0 || result.stale.length > 0 || result.orphaned.length > 0;
}

/** The audit as the lines a person reads in a terminal or a CI log. */
export function renderCoverageReport({
  result,
  exclusions,
}: {
  result: CoverageResult;
  exclusions: readonly Exclusion[];
}): string {
  // Annotated because the list narrows to the categories it currently holds:
  // with the last `gap` entry closed, an unannotated comparison against "gap"
  // is a type error rather than the zero it should report.
  const gaps = exclusions.filter((entry: Exclusion) => entry.category === "gap").length;

  const lines = [
    `openapi route coverage: ${result.documented}/${result.mounted} mounted routes are in the document`,
    `unpublished on purpose: ${exclusions.length} entries (${gaps} of them recorded as gaps still worth closing)`,
  ];

  if (result.undocumentable.length > 0) {
    lines.push(
      `undocumentable by shape: ${result.undocumentable.length} route${result.undocumentable.length === 1 ? "" : "s"} answer 410 Gone or 404 an unknown version, so nothing about them can reach the document`,
    );
  }
  lines.push("");

  const sections = [
    formatUnexplained(result.unexplained),
    formatOrphaned(result.orphaned),
    formatStale(result.stale),
  ].filter((section) => section.length > 0);

  if (sections.length === 0) {
    lines.push("OK: every mounted route is documented or accounted for.");
    return lines.join("\n");
  }

  return [...lines, ...sections.map((section) => section.join("\n"))].join("\n");
}
