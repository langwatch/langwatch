import { resolve } from "node:path";
import { type Instant, nowInstant } from "@langwatch/time";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  expiredRows,
  liveKeys,
  readBaseline,
  shrinkCheck,
  staleRows,
} from "../../baseline.ts";
import type { ArchitectureViolation } from "../../types.ts";

const FILE_NAME = "boundary-edge-baseline.json";
const KINDS = ["cross-feature", "private-runtime-export"] as const;

export type BoundaryEdgeKind = (typeof KINDS)[number];

export type BoundaryEdge = { kind: BoundaryEdgeKind; from: string; to: string };

export type BoundaryEdgeBaselineCheck = {
  violations: ArchitectureViolation[];
  entries: BaselineEntry[];
  bootstrapped: boolean;
};

/** The key of a boundary-edge row: `<kind>|<from>|<to>`. */
function key(edge: BoundaryEdge): string {
  return `${edge.kind}|${edge.from}|${edge.to}`;
}

/** The edge a key names, for the copy that has to read it back out. */
function edgeOf(entry: BaselineEntry): string {
  const [kind, from, to] = entry.key.split("|");

  return `${kind} ${from} -> ${to}`;
}

export const BOUNDARY_EDGE_BASELINE: BaselinePolicy = {
  id: "boundary-edge",
  file: FILE_NAME,
  label: "Boundary edge baseline",
  keyRule: "A key is `<kind>|<from>|<to>`, kind one of cross-feature, private-runtime-export.",
  enforceExpiry: true,
  // The `-stale` spelling predates the shared reader; normalising it changes
  // nine finding lines, so it is named here rather than assumed.
  staleAs: "boundary-edge-baseline-stale",
  expiredAs: "boundary-edge-expired",
  growthAs: "boundary-edge-baseline-growth",
  expired: (entry) => ({
    message: `Boundary edge baseline entry ${edgeOf(entry)} expired ${entry.expires}.`,
    allowed:
      "Close the edge behind a port and contract and delete the entry, or bring its own review forward with a new date.",
  }),
  stale: (entry) => ({
    message: `Boundary edge baseline entry ${edgeOf(entry)} no longer exists.`,
    allowed: "Delete the stale entry so the checked-in baseline only shrinks.",
  }),
  growth: {
    added: (entry) => ({
      message: `Boundary edge baseline cannot add ${edgeOf(entry)}.`,
      allowed: "Close the edge behind a port and contract instead of adding it to the baseline.",
    }),
    postponed: (entry) => ({
      message: `Boundary edge baseline cannot move ${edgeOf(entry)}'s expiry later.`,
      allowed: "Keep the prior expiry, or bring it earlier.",
    }),
  },
};

export function boundaryEdgeBaselineFile(root: string): string {
  return baselinePath({ root, policy: BOUNDARY_EDGE_BASELINE });
}

/**
 * Reads and validates `boundary-edge-baseline.json`. An expired entry fails
 * the run in its own right; an entry that no longer appears among
 * `currentEdges` is stale and must be deleted. With a `baselineReference`
 * (the merge-base copy), the file may only shrink.
 */
export function lintBoundaryEdgeBaseline(
  root: string,
  currentEdges: readonly BoundaryEdge[],
  baselineReference?: string,
  now: Instant = nowInstant(),
): BoundaryEdgeBaselineCheck {
  const file = boundaryEdgeBaselineFile(root);
  const current = readBaseline({ policy: BOUNDARY_EDGE_BASELINE, file });
  const found = new Set(currentEdges.map(key));

  const violations = [
    ...current.violations,
    ...expiredRows({ entries: current.entries, policy: BOUNDARY_EDGE_BASELINE, file, now }),
    ...staleRows({
      entries: current.entries,
      found,
      policy: BOUNDARY_EDGE_BASELINE,
      file,
      skipExpired: true,
      now,
    }),
  ];

  if (baselineReference && !current.exists) {
    violations.push({
      policy: "boundary-edge-baseline",
      file,
      message: "Boundary edge baseline must be checked in before it can be compared.",
      allowed: "Commit the reviewed baseline once; future merge-base checks may only shrink it.",
    });
  }

  if (!baselineReference) {
    return { violations, entries: current.entries, bootstrapped: false };
  }

  const reference = readBaseline({
    policy: BOUNDARY_EDGE_BASELINE,
    file: resolve(root, baselineReference),
  });
  violations.push(...reference.violations);

  if (!reference.exists) {
    return { violations, entries: current.entries, bootstrapped: current.exists };
  }

  violations.push(
    ...shrinkCheck({
      current: current.entries,
      reference: reference.entries,
      policy: BOUNDARY_EDGE_BASELINE,
      file,
    }),
  );

  return { violations, entries: current.entries, bootstrapped: false };
}

/** The `{kind, from, to}` edges a violations list carries for the two baselined policies. `file`/`specifier` must already be the desired `from`/`to` strings (workspace-relative, as `lintWorkspace` emits). */
export function boundaryEdgesFromViolations(
  violations: readonly ArchitectureViolation[],
): BoundaryEdge[] {
  return violations
    .filter(
      (violation): violation is ArchitectureViolation & { specifier: string } =>
        (violation.policy === "cross-feature" || violation.policy === "private-runtime-export") &&
        violation.specifier !== void 0,
    )
    .map((violation) => ({
      kind: violation.policy as BoundaryEdgeKind,
      from: violation.file,
      to: violation.specifier,
    }));
}

/** Drops a cross-feature/private-runtime-export violation whose edge is listed and not expired. Every other violation passes through untouched. */
export function filterBaselinedBoundaryEdges(
  violations: readonly ArchitectureViolation[],
  entries: readonly BaselineEntry[],
  now: Instant = nowInstant(),
): ArchitectureViolation[] {
  const allowed = liveKeys({ entries, now });

  return violations.filter((violation) => {
    if (violation.policy !== "cross-feature" && violation.policy !== "private-runtime-export") {
      return true;
    }

    return !allowed.has(
      key({
        kind: violation.policy as BoundaryEdgeKind,
        from: violation.file,
        to: violation.specifier ?? "",
      }),
    );
  });
}
