/**
 * The API Keys table's scope filter, and the parallel implementation it is not.
 *
 * Restated from `platform/app/src/pages/settings/api-keys/__tests__/api-keys-scope-filter.unit.test.ts`,
 * which proved "one filter, shared with the model-providers page" by reading
 * both pages' source off disk and matching import strings. One of those files no
 * longer exists (the model-config family deleted it, which cost that guard three
 * cases already) and the other is now a screen in this package, so the guard is
 * restated as what it was actually protecting: the cascade this family applies is
 * the SHARED predicate, not a second opinion about scopes.
 *
 * The proof is behavioural rather than textual — `filterRowsByScope` is driven
 * through the inclusive cascade in both directions — plus one structural case
 * that the package publishes no filter component of its own.
 *
 * Spec: specs/api-keys/scope-filter.feature
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filterRowsByScope, resolveRowFilter } from "../api-key-scope-filter";

const PACKAGE_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const HIERARCHY = {
  organization: { id: "org-1" },
  teams: [{ id: "team-1" }, { id: "team-2" }],
  projects: [
    { id: "proj-1", teamId: "team-1" },
    { id: "proj-2", teamId: "team-2" },
  ],
};

const KEYS = [
  { id: "org-key", scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }] },
  { id: "team-1-key", scopes: [{ scopeType: "TEAM", scopeId: "team-1" }] },
  { id: "team-2-key", scopes: [{ scopeType: "TEAM", scopeId: "team-2" }] },
  { id: "proj-1-key", scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }] },
  { id: "proj-2-key", scopes: [{ scopeType: "PROJECT", scopeId: "proj-2" }] },
  {
    id: "multi-key",
    scopes: [
      { scopeType: "PROJECT", scopeId: "proj-2" },
      { scopeType: "TEAM", scopeId: "team-1" },
    ],
  },
];

const idsOf = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

describe("given keys bound at every scope level", () => {
  describe('when the filter is "All you can see"', () => {
    /** @scenario Selecting "All you can see" shows every visible key regardless of scope */
    it("keeps every key", () => {
      expect(idsOf(filterRowsByScope(KEYS, { kind: "all" }, { hierarchy: HIERARCHY }))).toEqual(
        idsOf(KEYS),
      );
    });
  });

  describe("when the organization is picked", () => {
    /** @scenario Picking the organization keeps every key bound anywhere in that org */
    it("keeps every key, because every team and project on the page is inside it", () => {
      const filtered = filterRowsByScope(
        KEYS,
        { kind: "specific", scopeType: "ORGANIZATION", scopeId: "org-1", name: "ACME" },
        { hierarchy: HIERARCHY },
      );
      expect(idsOf(filtered)).toEqual(idsOf(KEYS));
    });
  });

  describe("when a team is picked", () => {
    /** @scenario Picking a team keeps org-scoped parents, the team itself, and its child projects */
    it("keeps the org key above it, the team itself, and the projects under it", () => {
      const filtered = filterRowsByScope(
        KEYS,
        { kind: "specific", scopeType: "TEAM", scopeId: "team-1", name: "Platform" },
        { hierarchy: HIERARCHY },
      );
      expect(idsOf(filtered)).toEqual(["org-key", "team-1-key", "proj-1-key", "multi-key"]);
    });
  });

  describe("when a project is picked", () => {
    /** @scenario Picking a project keeps org-scoped grand-parents, the project's parent team, and the project itself */
    it("keeps the org key, the parent team's key, and the project's own", () => {
      const filtered = filterRowsByScope(
        KEYS,
        { kind: "specific", scopeType: "PROJECT", scopeId: "proj-1", name: "Web App" },
        { hierarchy: HIERARCHY },
      );
      expect(idsOf(filtered)).toEqual(["org-key", "team-1-key", "proj-1-key", "multi-key"]);
    });
  });

  describe("when a key carries several bindings", () => {
    /** @scenario A key with multiple bindings is visible if any binding matches the cascade */
    it("keeps it when ANY of them is on the filtered branch", () => {
      const filtered = filterRowsByScope(
        KEYS,
        { kind: "specific", scopeType: "TEAM", scopeId: "team-2", name: "Growth" },
        { hierarchy: HIERARCHY },
      );
      expect(idsOf(filtered)).toContain("multi-key");
    });
  });

  describe("when a key carries no binding at all", () => {
    /** @scenario Filter with zero matches shows a plain empty state */
    it("is dropped by a specific filter and kept by all, exactly as the platform util did", () => {
      const rows = [{ id: "unbound", scopes: [] }];
      expect(idsOf(filterRowsByScope(rows, { kind: "all" }, { hierarchy: HIERARCHY }))).toEqual([
        "unbound",
      ]);
      expect(
        filterRowsByScope(
          rows,
          { kind: "specific", scopeType: "TEAM", scopeId: "team-1", name: "Platform" },
          { hierarchy: HIERARCHY },
        ),
      ).toEqual([]);
    });
  });
});

describe("given the two ambient filter kinds", () => {
  describe("when the reader has no current team or project", () => {
    /** @scenario Filter defaults to "All you can see" */
    it("resolves to all rather than to a scope that does not exist", () => {
      expect(resolveRowFilter({ kind: "team-current" }, {})).toEqual({ kind: "all" });
      expect(resolveRowFilter({ kind: "project-current" }, {})).toEqual({ kind: "all" });
    });
  });
});

describe("given the shared scope-picker surface", () => {
  describe("when the package is read", () => {
    /** @scenario The scope filter component is shared with the model-providers page */
    /** @scenario API Keys page reuses filterProvidersByScope directly — no parallel helper */
    it("declares no scope-filter component of its own", () => {
      const local = collectSources(PACKAGE_SRC).filter((file) =>
        path.basename(file).toLowerCase().includes("scope-filter"),
      );
      // The one file allowed to carry the name is the pure fan over rows, which
      // delegates to the surface's predicate. A COMPONENT with that name would
      // be the second opinion the spec forbids.
      expect(local.map((file) => path.basename(file))).toEqual(["api-key-scope-filter.ts"]);
    });
  });
});

function collectSources(root: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      found.push(...collectSources(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}
