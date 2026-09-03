import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ArchitectureViolation } from "./types";

const FILE_NAME = "boundary-edge-baseline.json";
const KINDS = ["cross-feature", "private-runtime-export"] as const;

export type BoundaryEdgeKind = (typeof KINDS)[number];

export type BoundaryEdgeEntry = {
  kind: BoundaryEdgeKind;
  from: string;
  to: string;
  expires: string;
};

export type BoundaryEdge = { kind: BoundaryEdgeKind; from: string; to: string };

export type BoundaryEdgeBaselineCheck = {
  violations: ArchitectureViolation[];
  entries: BoundaryEdgeEntry[];
  bootstrapped: boolean;
};

const entrySchema = z
  .object({
    kind: z.enum(KINDS),
    from: z.string().min(1),
    to: z.string().min(1),
    expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
const fileSchema = z
  .object({ version: z.literal(0), edges: z.array(entrySchema) })
  .strict();

export function boundaryEdgeBaselineFile(root: string): string {
  return join(root, "packages/architecture-lint/src", FILE_NAME);
}

function key(entry: BoundaryEdge): string {
  return `${entry.kind}\0${entry.from}\0${entry.to}`;
}

function readBoundaryEdgeBaselineFile(file: string): {
  exists: boolean;
  entries: BoundaryEdgeEntry[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) return { exists: false, entries: [], violations: [] };

  let rawValue: unknown;
  try {
    rawValue = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      exists: true,
      entries: [],
      violations: [
        {
          policy: "boundary-edge-baseline",
          file,
          message: `Boundary edge baseline must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = fileSchema.safeParse(rawValue);
  if (!result.success) {
    return {
      exists: true,
      entries: [],
      violations: [
        {
          policy: "boundary-edge-baseline",
          file,
          message:
            "Boundary edge baseline must contain version 0 and an edges array of { kind, from, to, expires }.",
        },
      ],
    };
  }

  const seen = new Set<string>();
  const violations: ArchitectureViolation[] = [];
  const entries: BoundaryEdgeEntry[] = [];
  for (const entry of result.data.edges) {
    const entryKey = key(entry);
    if (seen.has(entryKey)) {
      violations.push({
        policy: "boundary-edge-baseline",
        file,
        message: `Boundary edge baseline lists ${entry.kind} ${entry.from} -> ${entry.to} more than once.`,
      });
      continue;
    }
    seen.add(entryKey);
    entries.push(entry);
  }
  return { exists: true, entries, violations };
}

/** Growth check against a merge-base reference: an edge may only be removed, never added, and its expiry may only move earlier. */
export function compareBoundaryEdgeBaseline(
  reference: readonly BoundaryEdgeEntry[],
  proposed: readonly BoundaryEdgeEntry[],
  file: string,
): ArchitectureViolation[] {
  const referenceByKey = new Map(reference.map((entry) => [key(entry), entry]));
  const violations: ArchitectureViolation[] = [];
  for (const entry of proposed) {
    const previous = referenceByKey.get(key(entry));
    if (!previous) {
      violations.push({
        policy: "boundary-edge-baseline-growth",
        file,
        message: `Boundary edge baseline cannot add ${entry.kind} ${entry.from} -> ${entry.to}.`,
        allowed: "Close the edge behind a port and contract instead of adding it to the baseline.",
      });
      continue;
    }
    if (entry.expires > previous.expires) {
      violations.push({
        policy: "boundary-edge-baseline-growth",
        file,
        message: `Boundary edge baseline cannot move ${entry.kind} ${entry.from} -> ${entry.to}'s expiry later.`,
        allowed: "Keep the prior expiry, or bring it earlier.",
      });
    }
  }
  return violations;
}

/**
 * Reads and validates `boundary-edge-baseline.json`. An expired entry fails
 * the run in its own right; an entry that no longer appears among
 * `currentEdges` is stale and must be deleted. With a `baselineReference`
 * (the merge-base copy), the file may only shrink, mirroring
 * `lintCommentBlockRoots`.
 */
export function lintBoundaryEdgeBaseline(
  root: string,
  currentEdges: readonly BoundaryEdge[],
  baselineReference?: string,
  now: Date = new Date(),
): BoundaryEdgeBaselineCheck {
  const file = boundaryEdgeBaselineFile(root);
  const current = readBoundaryEdgeBaselineFile(file);
  const violations = [...current.violations];
  const today = now.toISOString().slice(0, 10);
  const currentKeys = new Set(currentEdges.map(key));

  for (const entry of current.entries) {
    if (entry.expires < today) {
      violations.push({
        policy: "boundary-edge-expired",
        file,
        message: `Boundary edge baseline entry ${entry.kind} ${entry.from} -> ${entry.to} expired ${entry.expires}.`,
        allowed:
          "Close the edge behind a port and contract and delete the entry, or bring its own review forward with a new date.",
      });
      continue;
    }
    if (!currentKeys.has(key(entry))) {
      violations.push({
        policy: "boundary-edge-baseline-stale",
        file,
        message: `Boundary edge baseline entry ${entry.kind} ${entry.from} -> ${entry.to} no longer exists.`,
        allowed: "Delete the stale entry so the checked-in baseline only shrinks.",
      });
    }
  }

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

  const reference = readBoundaryEdgeBaselineFile(resolve(root, baselineReference));
  violations.push(...reference.violations);
  if (!reference.exists) {
    return { violations, entries: current.entries, bootstrapped: current.exists };
  }
  violations.push(...compareBoundaryEdgeBaseline(reference.entries, current.entries, file));
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
  entries: readonly BoundaryEdgeEntry[],
  now: Date = new Date(),
): ArchitectureViolation[] {
  const today = now.toISOString().slice(0, 10);
  const allowed = new Set(
    entries.filter((entry) => entry.expires >= today).map(key),
  );
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
