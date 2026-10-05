/**
 * Specs: peer-cycles, eventing-table-access and framework-module-contracts features.
 * Record: dev/docs/ARCHITECTURE.md §5 (peer cycles, no list), §7 and §10.1, §17 on the lists.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  frameworkContractEdges,
  frameworkContractKey,
} from "../src/policies/boundaries/framework-module-contracts.ts";
import { peerCycleEdges } from "../src/policies/boundaries/peer-cycles.ts";
import {
  collectEventingTableAccess,
  eventingAccessKey,
} from "../src/policies/persistence/eventing-table-access.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const EVENTING_TABLES = join(here, "baselines", "eventing-table-access.json");
const FRAMEWORK_CONTRACTS = join(here, "baselines", "framework-module-contracts.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
});

function peerCycleKeys(): string[] {
  return peerCycleEdges({ packages: snapshot.packages }).map(
    (edge) => `${edge.from} -> ${edge.to}`,
  );
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

function frameworkContracts() {
  return compareRatchet({
    current: countByKey(frameworkContractEdges({ snapshot }).map(frameworkContractKey)),
    listed: readRatchet({ file: FRAMEWORK_CONTRACTS }).findings,
  });
}

describe("the ruled transition lists", () => {
  describe("when the framework packages' contract dependencies are read", () => {
    /** @scenario "No framework package gains a module contract dependency" */
    it("finds none missing from the list", () => {
      expect(
        frameworkContracts().grown,
        "let the owning module declare it instead (§10.1)",
      ).toEqual([]);
    });

    /** @scenario "A dropped contract dependency leaves the list in the same change" */
    it("finds every listed edge still present", () => {
      expect(
        frameworkContracts().stale,
        "remove these from tests/baselines/framework-module-contracts.json",
      ).toEqual([]);
    });
  });

  describe("when the tree's peer cycle edges are read", () => {
    /** @scenario "No peer cycle edge exists" */
    it("the tree has no peer cycle edge", () => {
      expect(
        peerCycleKeys(),
        "cut the cycle from the reactor's side (§5); the cycles are mapped in dev/docs/plans/peer-cycles-2026-10-05.md",
      ).toEqual([]);
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
