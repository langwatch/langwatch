/**
 * Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13b.
 * The shrink-only list tests/baselines/peer-feature-directory.json; no policy reads it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { collectPeerFeatureDirectories } from "../src/policies/boundaries/peer-feature-directory.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "peer-feature-directory.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectPeerFeatureDirectories(snapshot).map((item) => item.directory)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("peer-feature-directory", () => {
  describe("when the tree's feature folders named after another module are listed", () => {
    /** @scenario "No new feature folder named after another module lands" */
    it("finds none above the list and every listed count still reached", () => {
      const { grown, stale } = compared();

      expect(grown, "move the folder into the module it names, or rename it (§17)").toEqual([]);
      expect(stale, "lower these in tests/baselines/peer-feature-directory.json").toEqual([]);
    }, 60_000);
  });
});
