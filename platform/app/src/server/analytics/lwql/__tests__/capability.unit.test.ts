/**
 * The tenant capability's derivation, pinned.
 *
 * The service-level test in `lwql.service.unit.test.ts` proves the service
 * sends *this* value; these prove the value itself is the one the key map is
 * provisioned against, and that the two ways it could quietly stop naming one
 * tenant — an unset secret, and bcrypt's silent truncation — are refusals
 * rather than wrong answers.
 */

import { compare } from "bcrypt";
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

    /**
     * The shape, not merely "it is not the secret" — a bcrypt digest could not
     * contain this secret whatever went wrong, so that assertion can never
     * fail on its own. This one pins what the key map has to store: the
     * `$2b$10$` prefix is how the work factor stays readable off the data, and
     * it is what would change silently if the cost were ever raised.
     */
    it("is a cost-10 bcrypt digest and never carries the raw secret", async () => {
      const capability = await lwqlTenantCapability({ secret: SECRET });

      expect(capability).toMatch(/^\$2b\$10\$[./A-Za-z0-9]{53}$/);
      expect(capability).not.toContain(SECRET);
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

  /**
   * The capability is the tenant's name in the key map, so the property that
   * matters is not just that two projects get different strings — it is that a
   * capability can only ever have come from its own project's secret. Asserted
   * with bcrypt's own verifier rather than by comparing our derivation against
   * itself, which would agree with any mistake made in both places.
   */
  describe("when a capability is checked against the secrets it could name", () => {
    /** @scenario "Two projects never derive the same tenant capability" */
    it("verifies against its own project's secret and no other", async () => {
      const mine = `${SECRET}-tenant-a`;
      const theirs = `${SECRET}-tenant-b`;
      const capability = await lwqlTenantCapability({ secret: mine });

      expect(await compare(mine, capability)).toBe(true);
      expect(await compare(theirs, capability)).toBe(false);
    });
  });

  /**
   * Determinism across calls and across interleavings — deliberately not a
   * cache test. A pure function of the secret returns these same values
   * whether the memoisation is present or absent, which is why the cache's own
   * properties are pinned in `capability-cache.unit.test.ts`, where a stubbed
   * boundary can observe them. What this block is for is the key map's
   * requirement: a project's capability is stable, and no two share one.
   */
  describe("when several projects derive capabilities in different orders", () => {
    /** @scenario "A project's tenant capability is the same every time it is derived" */
    it("gives each project the same capability every time, and never another's", async () => {
      const secrets = ["alpha", "beta", "gamma"].map(
        (name) => `${SECRET}-${name}`,
      );

      const cold = await Promise.all(
        secrets.map((secret) => lwqlTenantCapability({ secret })),
      );
      const warm = await Promise.all(
        [...secrets]
          .reverse()
          .map((secret) => lwqlTenantCapability({ secret })),
      );

      expect(warm).toEqual([...cold].reverse());
      // And no two projects share one, which is what the key map would need to
      // resolve two tenants to a single row.
      expect(new Set(cold).size).toBe(secrets.length);
    });
  });

  describe("when the secret was never selected", () => {
    /**
     * `undefined` hashes to a perfectly valid digest that matches no key-map
     * row, so the query succeeds and returns nothing — indistinguishable from a
     * tenant with no data. Throwing is what makes the wiring bug loud.
     */
    /** @scenario "An unset secret is refused rather than hashed" */
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
    /**
     * Pinned on both sides, because only one side is a security bug and the
     * other is an outage. Testing the refusal alone leaves `>` free to drift to
     * `>=`, which refuses every 72-byte secret — swallowed by the key-map sync
     * into a log line, so the project silently never gets a row.
     */
    it("accepts a secret of exactly 72 bytes", async () => {
      expect(await lwqlTenantCapability({ secret: "x".repeat(72) })).toMatch(
        /^\$2b\$10\$/,
      );
    });

    /** @scenario "A secret the derivation cannot represent is refused, never truncated" */
    it("refuses the first byte past the limit rather than truncating to it", async () => {
      await expect(
        lwqlTenantCapability({ secret: "x".repeat(73) }),
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
