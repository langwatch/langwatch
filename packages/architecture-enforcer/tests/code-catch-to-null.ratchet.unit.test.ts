/**
 * Spec: specs/code-catch-to-null.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 7d (Alex, 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  codeCatchToNullKey,
  collectCodeCatchToNull,
} from "../src/policies/quality/code-catch-to-null.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "code-catch-to-null.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectCodeCatchToNull(snapshot).map(codeCatchToNullKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the code-catch-to-null list", () => {
  describe("when the tree's code-tested catches that answer null are counted", () => {
    /** @scenario "No file gains a code-tested catch that answers null" */
    it("finds none above the list and every listed count still reached", () => {
      const { grown, stale } = compared();

      expect(grown, "call the owner's find* and read [] instead (ADR-146)").toEqual([]);
      expect(stale, "lower these in tests/baselines/code-catch-to-null.json").toEqual([]);
    }, 60_000);
  });
});
