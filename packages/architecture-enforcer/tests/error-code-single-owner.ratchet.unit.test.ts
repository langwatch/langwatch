/**
 * Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13c.
 * The shrink-only list tests/baselines/error-code-single-owner.json; no policy reads it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { errorCodeSingleOwnerKeys } from "../src/policies/boundaries/error-code-single-owner.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "error-code-single-owner.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(errorCodeSingleOwnerKeys({ root: snapshot.root })),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("error-code-single-owner", () => {
  describe("when the tree's codes declared by more than one class are counted", () => {
    /** @scenario "No new code gains a second declaring class" */
    it("finds none above the list and every listed count still reached", () => {
      const { grown, stale } = compared();

      expect(
        grown,
        "throw the code's existing class, or give the failure its own code (§17)",
      ).toEqual([]);
      expect(stale, "lower these in tests/baselines/error-code-single-owner.json").toEqual([]);
    }, 60_000);
  });
});
