/**
 * Spec: packages/architecture-enforcer/specs/design-system-use.feature.
 * Record: dev/docs/ARCHITECTURE.md §17, the design-system-recomposition shrink-only list (Alex,
 * 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  collectRecompositions,
  recompositionKey,
} from "../src/policies/frontend/design-system-recomposition.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "design-system-recomposition.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectRecompositions(snapshot).map(recompositionKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the design-system-recomposition list", () => {
  describe("when the tree's recompositions are counted", () => {
    /** @scenario "No browser file gains a rebuilt design-system component" */
    it("finds no key above its listed count", () => {
      expect(
        compared().grown,
        "use the design-system component instead (pnpm --filter @langwatch/architecture-enforcer lint shows each site)",
      ).toEqual([]);
    }, 60_000);

    /** @scenario "A removed recomposition lowers the list in the same change" */
    it("finds every listed count still reached", () => {
      expect(
        compared().stale,
        "lower these in tests/baselines/design-system-recomposition.json",
      ).toEqual([]);
    }, 60_000);
  });
});
