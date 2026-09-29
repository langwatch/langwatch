/**
 * Specs: specs/peer-cycles.feature, specs/eventing-table-access.feature.
 * Record: dev/docs/ARCHITECTURE.md §5 and §7 (Alex, 2026-09-29), §17 on these lists.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { peerCycleEdges } from "../src/policies/boundaries/peer-cycles.ts";
import {
  collectEventingTableAccess,
  eventingAccessKey,
} from "../src/policies/persistence/eventing-table-access.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const PEER_CYCLES = join(here, "baselines", "peer-cycle-edges.json");
const EVENTING_TABLES = join(here, "baselines", "eventing-table-access.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
});

function peerCycles() {
  const keys = peerCycleEdges({ packages: snapshot.packages }).map(
    (edge) => `${edge.from} -> ${edge.to}`,
  );

  return compareRatchet({
    current: countByKey(keys),
    listed: readRatchet({ file: PEER_CYCLES }).findings,
  });
}

function eventingTables() {
  const keys = collectEventingTableAccess({
    root: snapshot.root,
    catalogue: snapshot.catalogue,
  }).map((access) => eventingAccessKey({ root: snapshot.root, access }));

  return compareRatchet({
    current: countByKey(keys),
    listed: readRatchet({ file: EVENTING_TABLES }).findings,
  });
}

describe("the ruled transition lists", () => {
  describe("when the tree's peer cycle edges are read", () => {
    /** @scenario "No new peer cycle edge lands" */
    it("finds none missing from the list", () => {
      expect(peerCycles().grown, "cut the cycle from the reactor's side (§5)").toEqual([]);
    });

    /** @scenario "A cut peer cycle edge leaves the list in the same change" */
    it("finds every listed edge still present", () => {
      expect(peerCycles().stale, "remove these from tests/baselines/peer-cycle-edges.json").toEqual(
        [],
      );
    });
  });

  describe("when the tree's raw event-table accesses are read", () => {
    /** @scenario "No new raw access to an event table lands" */
    it("finds no file above its listed count", () => {
      expect(eventingTables().grown, "send the pipeline a command instead (§7)").toEqual([]);
    });

    /** @scenario "A removed access lowers the list in the same change" */
    it("finds every listed count still reached", () => {
      expect(
        eventingTables().stale,
        "lower these in tests/baselines/eventing-table-access.json",
      ).toEqual([]);
    });
  });

  describe("given a list and a tree that disagree", () => {
    it("refuses growth inside a listed key, not only a new key", () => {
      expect(
        compareRatchet({
          current: new Map([
            ["a|f.ts|sql:event_log", 2],
            ["b|g.ts|sql:event_log", 1],
          ]),
          listed: { "a|f.ts|sql:event_log": 1, "c|h.ts|named:event_log": 1 },
        }),
      ).toEqual({
        grown: [
          "a|f.ts|sql:event_log: 2 found, 1 listed",
          "b|g.ts|sql:event_log: 1 found, 0 listed",
        ],
        stale: ["c|h.ts|named:event_log: 0 found, 1 listed"],
      });
    });
  });
});
