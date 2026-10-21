/**
 * Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13d.
 * The shrink-only list tests/baselines/peer-api-fan-in.json; no policy reads it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  collectPeerApiFanIn,
  peerApiFanInKeys,
} from "../src/policies/boundaries/peer-api-fan-in.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "peer-api-fan-in.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(
      peerApiFanInKeys({ root: snapshot.root, found: collectPeerApiFanIn(snapshot) }),
    ),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("peer-api-fan-in", () => {
  describe("when the tree's services leaning on one peer Api are counted", () => {
    /** @scenario "No service gains a fourth operation of one peer Api" */
    it("finds none above the list and every listed count still reached", () => {
      const { grown, stale } = compared();

      expect(grown, "ask the peer for one operation that does the work (§17)").toEqual([]);
      expect(stale, "lower these in tests/baselines/peer-api-fan-in.json").toEqual([]);
    }, 60_000);
  });
});
