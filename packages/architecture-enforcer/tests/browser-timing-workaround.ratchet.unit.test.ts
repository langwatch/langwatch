/**
 * Spec: packages/architecture-enforcer/specs/design-system-use.feature.
 * Record: dev/docs/ARCHITECTURE.md §17, the browser-timing-workaround shrink-only list (Alex,
 * 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  collectTimingWorkarounds,
  timingKey,
} from "../src/policies/frontend/browser-timing-workaround.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "browser-timing-workaround.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectTimingWorkarounds(snapshot).map(timingKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the browser-timing-workaround list", () => {
  describe("when the tree's timing workarounds are counted", () => {
    /** @scenario "No browser file gains a timing workaround" */
    it("finds no key above its listed count", () => {
      expect(
        compared().grown,
        "wait on a ref, an observer or the data instead (pnpm --filter @langwatch/architecture-enforcer lint shows each site)",
      ).toEqual([]);
    }, 60_000);

    /** @scenario "A removed timing workaround lowers the list in the same change" */
    it("finds every listed count still reached", () => {
      expect(
        compared().stale,
        "lower these in tests/baselines/browser-timing-workaround.json",
      ).toEqual([]);
    }, 60_000);
  });
});
