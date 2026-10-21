/**
 * Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13a.
 * The shrink-only list tests/baselines/prisma-model-ownership.json; no policy reads it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  prismaModelOwnershipFindings,
  prismaModelOwnershipKey,
} from "../src/policies/persistence/prisma-model-ownership.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "prisma-model-ownership.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(
      prismaModelOwnershipFindings({ root: snapshot.root, catalogue: snapshot.catalogue }).map(
        (access) => prismaModelOwnershipKey({ root: snapshot.root, access }),
      ),
    ),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("prisma-model-ownership", () => {
  describe("when the tree's reaches of a peer's Prisma model are counted", () => {
    /** @scenario "No new reach of a peer's Prisma model lands" */
    it("finds none above the list and every listed count still reached", () => {
      const { grown, stale } = compared();

      expect(grown, "ask the owning module through its *Api instead (§17)").toEqual([]);
      expect(stale, "lower these in tests/baselines/prisma-model-ownership.json").toEqual([]);
    }, 60_000);
  });
});
