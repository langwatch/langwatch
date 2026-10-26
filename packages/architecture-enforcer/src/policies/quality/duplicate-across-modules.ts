import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { moduleRootOf } from "./peer-route-literal.ts";

/**
 * Rule 4 of dev/docs/plans/platform-architecture-blocks.md: a source file copied byte for byte
 * into a second module is two owners of one behaviour, and the copies drift. Shrink-only:
 * tests/baselines/duplicate-across-modules.json holds today's copies, one key per file.
 */

export const DUPLICATE_ACROSS_MODULES_POLICY = "duplicate-across-modules";
export const DUPLICATE_ACROSS_MODULES_RATCHET =
  "packages/architecture-enforcer/tests/baselines/duplicate-across-modules.json";

const MODULE_TREES = ["modules", "enterprise/modules"] as const;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const TEST_FILE =
  /(?:__tests__|__fixtures__|__mocks__|\/fixtures\/|\/e2e\/|\.(?:test|spec|stories|fixture|d)\.)/;
const GENERATED = /(?:^|\/)generated\/|\.generated\./;
/** Tool configuration repeats by design: every package carries the same vitest or build setup. */
const CONFIG_FILE = /(?:^|\.)config\.[cm]?tsx?$|^(?:vitest|vite|tsup|setup)[.-]/;
/** Below this a file is an index, a re-statement of one call, or a type stub: not worth a home. */
const MINIMUM_BYTES = 400;

/** One copied file and the copies of it in other modules. */
export type DuplicateCopy = { file: string; module: string; copies: readonly string[] };

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

function isCandidate(path: string): boolean {
  return (
    SOURCE_FILE.test(path) &&
    !TEST_FILE.test(path) &&
    !GENERATED.test(path) &&
    !CONFIG_FILE.test(basename(path))
  );
}

/** Every module file whose exact text (line endings aside) also lives in another module. */
export function collectDuplicatesAcrossModules(snapshot: WorkspaceSnapshot): DuplicateCopy[] {
  const { root } = snapshot;
  const groups = new Map<string, { file: string; module: string }[]>();

  for (const tree of MODULE_TREES) {
    for (const file of snapshot.files({ directory: join(root, tree), accept: isCandidate })) {
      if (statSync(file).size <= MINIMUM_BYTES) continue;

      const path = workspacePath({ root, file });
      const module = moduleRootOf(path);
      if (module === undefined) continue;

      const text = sourceText({ file }).replace(/\r\n?/g, "\n");
      const digest = createHash("sha256").update(text).digest("hex");
      groups.set(digest, [...(groups.get(digest) ?? []), { file: path, module }]);
    }
  }

  return [...groups.values()].flatMap((group) => {
    if (new Set(group.map((member) => member.module)).size < 2) return [];

    return group.map((member) => ({
      ...member,
      copies: group
        .filter((other) => other.module !== member.module)
        .map((other) => other.file)
        .toSorted(),
    }));
  });
}

/** The shrink-only list's key: the copied file. */
export function duplicateAcrossModulesKey(copy: DuplicateCopy): string {
  return copy.file;
}

export function lintDuplicatesAcrossModules(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectDuplicatesAcrossModules(snapshot).map((copy) => ({
    policy: DUPLICATE_ACROSS_MODULES_POLICY,
    file: copy.file,
    specifier: copy.copies[0],
    message: `This file is a byte-for-byte copy of ${copy.copies.join(", ")}: two modules now own one behaviour, and the next fix lands in one copy only.`,
    allowed: `Keep one copy in the owning module's contract or package and import it from there. Each count in ${DUPLICATE_ACROSS_MODULES_RATCHET} may fall, never rise.`,
  }));
}
