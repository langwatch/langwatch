/**
 * Spec: specs/literal-ownership.feature (restated-contract-constant).
 * Record: dev/docs/ARCHITECTURE.md §17, dev/docs/plans/platform-architecture-blocks.md rule 16
 * (Alex, 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  collectRestatedContractConstants,
  restatedConstantKey,
} from "../src/policies/quality/restated-contract-constant.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "restated-contract-constant.json");

let snapshot: WorkspaceSnapshot;

/** A whole-tree reading: one walk and a parse of every candidate file. */
beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectRestatedContractConstants(snapshot).map(restatedConstantKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the restated-contract-constant shrink-only list", () => {
  describe("when the tree's restated contract constants are counted", () => {
    /** @scenario "No new restated contract constant lands" */
    it("finds no key above its listed count and no listed count above the tree", () => {
      const { grown, stale } = compared();

      expect(grown, "import the constant from its contract (rule 16)").toEqual([]);
      expect(
        stale,
        "lower these counts in tests/baselines/restated-contract-constant.json",
      ).toEqual([]);
    }, 60_000);
  });
});
