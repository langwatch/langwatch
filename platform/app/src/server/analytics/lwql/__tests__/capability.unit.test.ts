/**
 * The tenant capability: the single-project hash and the multi-project set.
 *
 * The set is what a coding-agent key sends so one query reaches every project
 * it can read (#8085). The claims that matter are that it is derived from the
 * same hash the key map stores (so the two cannot drift), that it is
 * deterministic (sorted, deduplicated), and that an empty scope is a valid
 * zero-row scope rather than an error — the row policy resolves the empty
 * default to no rows.
 *
 * @see ../capability.ts
 * @see ../provisioning/accessModel.ts — the key map this value is looked up in
 * @see specs/lwql/api.feature
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LWQL_TENANT_CAPABILITY_MAX_PROJECTS,
  lwqlTenantCapability,
  lwqlTenantCapabilitySet,
} from "../capability";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

describe("given a single project's LangWatchQL secret", () => {
  it("is the sha256 hex of the secret", () => {
    expect(lwqlTenantCapability({ secret: "sk-lw-alpha" })).toBe(
      sha256Hex("sk-lw-alpha"),
    );
  });

  it("refuses an empty secret rather than hashing one", () => {
    expect(() => lwqlTenantCapability({ secret: "" })).toThrow(
      "requires a non-empty secret",
    );
  });
});

describe("given the LangWatchQL secrets of the projects a key can read", () => {
  describe("when the tenant capability set is derived", () => {
    /** @scenario "The tenant capability is the sorted set of the caller's project key hashes" */
    it("is the comma-joined, sorted hash of each secret", () => {
      const set = lwqlTenantCapabilitySet({
        secrets: ["sk-lw-beta", "sk-lw-alpha"],
      });

      expect(set.split(",")).toEqual(
        [sha256Hex("sk-lw-alpha"), sha256Hex("sk-lw-beta")].sort(),
      );
    });

    /** @scenario "The tenant capability is the sorted set of the caller's project key hashes" */
    it("deduplicates a secret shared by two projects", () => {
      const set = lwqlTenantCapabilitySet({
        secrets: ["sk-lw-alpha", "sk-lw-alpha"],
      });

      expect(set).toBe(sha256Hex("sk-lw-alpha"));
      expect(set).not.toContain(",");
    });

    /** @scenario "The tenant capability is the sorted set of the caller's project key hashes" */
    it("uses the same hash the single-project form and the key map store", () => {
      // A second hashing implementation is a silent drift: the query would
      // succeed and return zero rows. The set must be built from the same fn.
      expect(lwqlTenantCapabilitySet({ secrets: ["sk-lw-alpha"] })).toBe(
        lwqlTenantCapability({ secret: "sk-lw-alpha" }),
      );
    });

    /**
     * The whole point of the empty case: a key that can read nothing derives
     * the profile's empty default, which `splitByChar(',', '')` resolves to a
     * single empty element no 64-hex hash matches — zero rows, never an error.
     */
    /** @scenario "The tenant capability is the sorted set of the caller's project key hashes" */
    it("derives the empty capability for an empty project set", () => {
      expect(lwqlTenantCapabilitySet({ secrets: [] })).toBe("");
    });

    it("still refuses a blank secret inside the set — a wiring bug, not a scope", () => {
      expect(() =>
        lwqlTenantCapabilitySet({ secrets: ["sk-lw-alpha", ""] }),
      ).toThrow("requires a non-empty secret");
    });

    it("refuses a set larger than the documented cap", () => {
      const secrets = Array.from(
        { length: LWQL_TENANT_CAPABILITY_MAX_PROJECTS + 1 },
        (_unused, index) => `sk-lw-${index}`,
      );

      expect(() => lwqlTenantCapabilitySet({ secrets })).toThrow(
        /over the .* cap/,
      );
    });
  });
});
