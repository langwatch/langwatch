/**
 * Spec: packages/architecture-enforcer/specs/design-system-use.feature.
 * Record: dev/docs/ARCHITECTURE.md §17, the raw-colour shrink-only list (Alex, 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { collectRawColours, rawColourKey } from "../src/policies/frontend/raw-colour.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "raw-colour.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectRawColours(snapshot).map(rawColourKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the raw-colour list", () => {
  describe("when the tree's raw colours are counted", () => {
    /** @scenario "No browser file gains a raw colour" */
    it("finds no key above its listed count", () => {
      expect(
        compared().grown,
        "name a semantic token instead (pnpm --filter @langwatch/architecture-enforcer lint shows each site)",
      ).toEqual([]);
    }, 60_000);

    /** @scenario "A removed raw colour lowers the list in the same change" */
    it("finds every listed count still reached", () => {
      expect(compared().stale, "lower these in tests/baselines/raw-colour.json").toEqual([]);
    }, 60_000);
  });
});
