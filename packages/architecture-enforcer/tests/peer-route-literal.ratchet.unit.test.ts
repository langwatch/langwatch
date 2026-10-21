/**
 * Spec: specs/literal-ownership.feature (peer-route-literal). Record: dev/docs/ARCHITECTURE.md §17,
 * dev/docs/plans/platform-architecture-blocks.md rule 3 (Alex, 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  collectPeerRouteLiterals,
  peerRouteLiteralKey,
} from "../src/policies/quality/peer-route-literal.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "peer-route-literal.json");

let snapshot: WorkspaceSnapshot;

/** A whole-tree reading: one walk and a parse of every candidate file. */
beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectPeerRouteLiterals(snapshot).map(peerRouteLiteralKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the peer-route-literal shrink-only list", () => {
  describe("when the tree's peer route literals are counted per file and address", () => {
    /** @scenario "No new peer route literal lands" */
    it("finds no key above its listed count and no listed count above the tree", () => {
      const { grown, stale } = compared();

      expect(grown, "build the address with the owner's exported href builder (rule 3)").toEqual(
        [],
      );
      expect(stale, "lower these counts in tests/baselines/peer-route-literal.json").toEqual([]);
    }, 60_000);
  });
});
