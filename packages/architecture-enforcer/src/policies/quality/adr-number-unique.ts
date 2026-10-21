import { basename, dirname, join, relative, sep } from "node:path";

import type { ArchitectureViolation } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Rule 10 of dev/docs/plans/platform-architecture-blocks.md: two ADRs under one number make every
 * citation ambiguous, so numbers are unique per ADR folder. Shrink-only baseline: tests/baselines.
 */

export const ADR_NUMBER_UNIQUE_POLICY = "adr-number-unique";
export const ADR_NUMBER_UNIQUE_RATCHET =
  "packages/architecture-enforcer/tests/baselines/adr-number-unique.json";

/** Where ADR folders live; each is walked once and every `adr/` or `adrs/` folder in it read. */
const SEARCHED_TREES = ["dev", "modules", "enterprise", "packages", "apps", "tools", "services"];
const ADR_FILE = /(?:^|\/)adrs?\/(\d+)-[^/]*\.md$/;

/** One ADR number used by more than one record in a folder. */
export type AdrNumberCollision = { folder: string; number: string; files: readonly string[] };

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

/** Every number two or more records share within one ADR folder. */
export function collectAdrNumberCollisions(snapshot: WorkspaceSnapshot): AdrNumberCollision[] {
  const { root } = snapshot;
  const byNumber = new Map<string, { folder: string; number: string; files: string[] }>();

  for (const tree of SEARCHED_TREES) {
    for (const file of snapshot.files({
      directory: join(root, tree),
      accept: (path) => ADR_FILE.test(path.split(sep).join("/")),
    })) {
      const path = workspacePath({ root, file });
      const digits = ADR_FILE.exec(path)?.[1];
      if (digits === undefined) continue;

      const folder = dirname(path);
      const number = String(Number(digits)).padStart(3, "0");
      const key = `${folder}|${number}`;
      const entry = byNumber.get(key) ?? { folder, number, files: [] };
      entry.files.push(path);
      byNumber.set(key, entry);
    }
  }

  return [...byNumber.values()]
    .filter((entry) => entry.files.length > 1)
    .map((entry) => ({ ...entry, files: entry.files.toSorted() }))
    .toSorted((left, right) =>
      adrNumberKey(left).localeCompare(adrNumberKey(right), undefined, { numeric: true }),
    );
}

/** The shrink-only list's key: the folder and the shared number; its count is the record count. */
export function adrNumberKey(collision: Pick<AdrNumberCollision, "folder" | "number">): string {
  return `${collision.folder}|${collision.number}`;
}

export function lintAdrNumberUniqueness(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectAdrNumberCollisions(snapshot).flatMap((collision) =>
    collision.files.map((file) => ({
      policy: ADR_NUMBER_UNIQUE_POLICY,
      file,
      specifier: `ADR-${collision.number}`,
      message: `ADR-${collision.number} names ${collision.files.length} records in ${collision.folder} (${collision.files.map((other) => basename(other)).join(", ")}), so a citation of it cannot say which one it means.`,
      allowed: `Give the newer record the next free number in ${collision.folder} and update the citations that mean it. Each count in ${ADR_NUMBER_UNIQUE_RATCHET} may fall, never rise.`,
    })),
  );
}
