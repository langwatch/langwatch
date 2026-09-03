/**
 * The tenant capability's derivation, pinned.
 *
 * The service-level test in `lwql.service.unit.test.ts` proves the service
 * sends *this* value; these prove the value itself is the one the key map is
 * provisioned against, and that the two ways it could quietly stop naming one
 * tenant — an unset secret, and bcrypt's silent truncation — are refusals
 * rather than wrong answers.
 */

import { describe, expect, it } from "vitest";

import { lwqlTenantCapability } from "../capability";

const SECRET = "sk-lw-lwql-capability-unit-test-key";

describe("given a project's LangWatchQL secret", () => {
  describe("when the capability is derived", () => {
    /**
     * The known answer, and the only assertion here that can catch a change of
     * algorithm, salt derivation or work factor. It is written out rather than
     * recomputed: an expectation derived through the same function would agree
     * with it after any change, including a change that stopped hashing.
     *
     * It is also what proves the derivation is deterministic *across
     * processes*, which asserting one call against another cannot — this
     * constant was computed in a different process from the one running it.
     * That determinism is load-bearing: the key map resolves a tenant by
     * equality on this string, so a derivation that varied per call would make
     * every LangWatchQL read return zero rows.
     */
    it("matches the digest the key map is provisioned with", async () => {
      expect(await lwqlTenantCapability({ secret: SECRET })).toBe(
        "$2b$10$RnlZxIxlVQ4VDkYPOwjbouOPphk4TCJBsv1EWY.ldRkqHjcPBZx5C",
      );
    });

    it("never carries the raw secret it was derived from", async () => {
      expect(await lwqlTenantCapability({ secret: SECRET })).not.toContain(
        SECRET,
      );
    });

    it("gives two projects unrelated capabilities", async () => {
      const [first, second] = await Promise.all([
        lwqlTenantCapability({ secret: `${SECRET}-a` }),
        lwqlTenantCapability({ secret: `${SECRET}-b` }),
      ]);

      expect(first).not.toBe(second);
      // Distinct salts, not merely distinct digests: a shared salt would make
      // one precomputation serve every project in the key map.
      expect(first.slice(0, 29)).not.toBe(second.slice(0, 29));
    });
  });

  describe("when the secret was never selected", () => {
    /**
     * `undefined` hashes to a perfectly valid digest that matches no key-map
     * row, so the query succeeds and returns nothing — indistinguishable from a
     * tenant with no data. Throwing is what makes the wiring bug loud.
     */
    it("refuses to derive a capability rather than hashing nothing", async () => {
      await expect(lwqlTenantCapability({ secret: "" })).rejects.toThrow(
        /non-empty secret/,
      );
    });
  });

  describe("when the secret is longer than bcrypt reads", () => {
    /**
     * bcrypt stops at 72 bytes. Two secrets sharing a 72-byte prefix therefore
     * derive the *same* capability, and two projects holding one capability
     * read each other's rows — the one failure this whole module exists to
     * prevent. `lwqlKey` is far shorter today, which is exactly why the refusal
     * has to be in the code: it is the day someone lengthens the secret that it
     * has to fire.
     */
    it("refuses the secret rather than silently truncating it", async () => {
      const atLimit = "x".repeat(72);

      await expect(
        lwqlTenantCapability({ secret: `${atLimit}-overflow` }),
      ).rejects.toThrow(/at most 72 bytes/);
    });

    /** Bytes, not characters — the limit bcrypt actually applies. */
    it("counts multi-byte characters against the limit", async () => {
      await expect(
        lwqlTenantCapability({ secret: "é".repeat(37) }),
      ).rejects.toThrow(/at most 72 bytes/);
    });
  });
});
