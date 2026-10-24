/**
 * Spec: specs/literal-ownership.feature (duplicate-across-modules).
 * Record: dev/docs/ARCHITECTURE.md §17, dev/docs/plans/platform-architecture-blocks.md rule 4
 * (Alex, 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  collectDuplicatesAcrossModules,
  duplicateAcrossModulesKey,
} from "../src/policies/quality/duplicate-across-modules.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "duplicate-across-modules.json");

let snapshot: WorkspaceSnapshot;

/** A whole-tree reading: one walk and a parse of every candidate file. */
beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectDuplicatesAcrossModules(snapshot).map(duplicateAcrossModulesKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the duplicate-across-modules shrink-only list", () => {
  describe("when the tree's cross-module copies are listed per file", () => {
    /** @scenario "No new cross-module copy lands" */
    it("finds no key above its listed count and no listed count above the tree", () => {
      const { grown, stale } = compared();

      expect(grown, "keep one copy in the owning module and import it (rule 4)").toEqual([]);
      expect(stale, "lower these counts in tests/baselines/duplicate-across-modules.json").toEqual(
        [],
      );
    }, 60_000);
  });
});
