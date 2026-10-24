/**
 * Spec: specs/tooling/lint-teaching-citations.feature. Record: dev/docs/ARCHITECTURE.md §17.
 * Reads the real tree and holds the dead path citations per page to the shrink-only list.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  collectDeadPathCitations,
  deadPathCitationKey,
} from "../src/policies/quality/dead-path-citations.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const BASELINE = join(here, "baselines", "dead-path-citations.json");

function deadPathCitations() {
  const keys = collectDeadPathCitations({ root: REPO_ROOT }).map((citation) =>
    deadPathCitationKey({ root: REPO_ROOT, citation }),
  );

  return compareRatchet({
    current: countByKey(keys),
    listed: readRatchet({ file: BASELINE }).findings,
  });
}

describe("the dead path citations list", () => {
  describe("when the reference pages, docs and specs are read", () => {
    /** @scenario "No page gains a dead path citation beyond the shrink-only list" */
    it("finds no page above its listed count", () => {
      expect(
        deadPathCitations().grown,
        "cite the file where it lives today, or drop the citation",
      ).toEqual([]);
    });

    /** @scenario "A page that drops a dead citation lowers its count in the same change" */
    it("finds every listed count still reached", () => {
      expect(
        deadPathCitations().stale,
        "lower these in tests/baselines/dead-path-citations.json",
      ).toEqual([]);
    });
  });
});
