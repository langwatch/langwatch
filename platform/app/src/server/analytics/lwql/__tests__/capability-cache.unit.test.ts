/**
 * The capability cache's two load-bearing properties, both of which need a
 * boundary moved to observe and so cannot live in `capability.unit.test.ts`.
 *
 * The cache is the one structure in the module shared by every tenant in the
 * process, and a deterministic function's *results* look identical whether it
 * is cached or not — so a test written against the returned values proves
 * determinism and would stay green if the cache were deleted outright. These
 * two are written against what the cache actually changes: how many times
 * bcrypt runs, and which entry a colliding key is allowed to answer with.
 *
 * `node:crypto` is stubbed to hand every secret the *same* cache key while
 * leaving the salt derivation real, which is the collision the `cached.salt`
 * check exists for and which no amount of real input can be made to produce.
 */

import { hkdfSync } from "node:crypto";

import { compare } from "bcrypt";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CACHE_KEY_INFO = "langwatchql.tenant-capability.cache-key.v1";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    hkdfSync: vi.fn(
      (
        digest: string,
        key: string,
        salt: string,
        info: string,
        keylen: number,
      ) =>
        info === CACHE_KEY_INFO
          ? new Uint8Array(keylen).fill(7).buffer
          : actual.hkdfSync(digest, key, salt, info, keylen),
    ),
  };
});

const hashSpy = vi.hoisted(() => vi.fn());

vi.mock("bcrypt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcrypt")>();
  hashSpy.mockImplementation(actual.hash);
  return { ...actual, hash: hashSpy };
});

import { lwqlTenantCapability } from "../capability";

describe("given the process-wide capability cache", () => {
  beforeEach(() => {
    hashSpy.mockClear();
  });

  /**
   * The failure this guards is the only way one project could be handed
   * another's capability in-process, and it is the reason the cache stores its
   * salt rather than just the digest. With the cache key forced to collide, a
   * lookup that trusted the key alone would answer the second project with the
   * first project's capability — a capability that names the wrong tenant in
   * the key map. The salt check has to turn that into a recomputation.
   */
  describe("when two projects' cache keys collide", () => {
    it("never answers one project with the other's capability", async () => {
      const mine = "collision-tenant-a-secret";
      const theirs = "collision-tenant-b-secret";

      const first = await lwqlTenantCapability({ secret: mine });
      const second = await lwqlTenantCapability({ secret: theirs });

      expect(second).not.toBe(first);
      // Asserted with bcrypt's own verifier: the capability handed to the
      // second project must be one only that project's secret produces.
      expect(await compare(theirs, second)).toBe(true);
      expect(await compare(mine, second)).toBe(false);
      // And the collision cost a recomputation rather than a wrong answer.
      expect(hashSpy).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * The memoisation is the sole reason a ~200ms KDF is affordable on the query
   * path. Nothing about the returned value reveals whether it happened, so it
   * is asserted where it is visible: bcrypt runs once per project, not once
   * per query.
   */
  describe("when one project derives its capability more than once", () => {
    it("runs bcrypt once and serves the rest from the cache", async () => {
      const secret = "memoised-tenant-secret";

      const cold = await lwqlTenantCapability({ secret });
      const warm = await lwqlTenantCapability({ secret });

      expect(warm).toBe(cold);
      expect(hashSpy).toHaveBeenCalledTimes(1);
    });

    /**
     * The cache holds the in-flight promise rather than the finished digest,
     * so the several queries a dashboard opens at once share one derivation.
     * Storing the resolved value instead would leave every concurrent caller
     * to start its own hash and occupy the whole libuv thread pool.
     */
    it("coalesces derivations that start before the first one finishes", async () => {
      const secret = "coalesced-tenant-secret";

      const capabilities = await Promise.all([
        lwqlTenantCapability({ secret }),
        lwqlTenantCapability({ secret }),
        lwqlTenantCapability({ secret }),
      ]);

      expect(new Set(capabilities).size).toBe(1);
      expect(hashSpy).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The stub is only trustworthy if it is actually installed — a `vi.mock`
   * factory that silently failed to apply would make every assertion above
   * pass for the wrong reason, because real cache keys never collide.
   */
  describe("when the collision stub is checked", () => {
    it("hands every secret the same cache key", () => {
      const keyFor = (secret: string) =>
        Buffer.from(
          hkdfSync("sha256", secret, "namespace", CACHE_KEY_INFO, 32),
        ).toString("hex");

      expect(keyFor("one")).toBe(keyFor("two"));
    });
  });
});
