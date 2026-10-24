/**
 * Spec: specs/literal-ownership.feature (adr-number-unique). Record: dev/docs/ARCHITECTURE.md §17,
 * dev/docs/plans/platform-architecture-blocks.md rule 10 (Alex, 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  adrNumberKey,
  collectAdrNumberCollisions,
} from "../src/policies/quality/adr-number-unique.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "adr-number-unique.json");

let snapshot: WorkspaceSnapshot;

/** A whole-tree reading: one walk and a parse of every candidate file. */
beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(
      collectAdrNumberCollisions(snapshot).flatMap((collision) =>
        collision.files.map(() => adrNumberKey(collision)),
      ),
    ),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the adr-number-unique shrink-only list", () => {
  describe("when the tree's ADR numbers are counted per folder", () => {
    /** @scenario "No new ADR number collision lands" */
    it("finds no key above its listed count and no listed count above the tree", () => {
      const { grown, stale } = compared();

      expect(grown, "give the newer record the next free number (rule 10)").toEqual([]);
      expect(stale, "lower these counts in tests/baselines/adr-number-unique.json").toEqual([]);
    }, 60_000);
  });
});
