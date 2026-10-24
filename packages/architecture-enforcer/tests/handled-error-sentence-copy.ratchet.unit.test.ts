/**
 * Spec: specs/handled-error-sentence-copy.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 8 (Alex, 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  handledErrorSentenceCopyKey,
  collectHandledErrorSentenceCopy,
} from "../src/policies/quality/handled-error-sentence-copy.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "handled-error-sentence-copy.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectHandledErrorSentenceCopy(snapshot).map(handledErrorSentenceCopyKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the handled-error-sentence-copy list", () => {
  describe("when the tree's coded failures with sentence copy are counted", () => {
    /** @scenario "No file gains a coded failure with sentence copy" */
    it("finds none above the list and every listed count still reached", () => {
      const { grown, stale } = compared();

      expect(grown, "carry the code and write the words in the presentation registry").toEqual([]);
      expect(stale, "lower these in tests/baselines/handled-error-sentence-copy.json").toEqual([]);
    }, 60_000);
  });
});
