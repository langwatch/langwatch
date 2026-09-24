/**
 * Installation-token cache contract: tokens under scope keys, expiring
 * liveness verdicts, and minting locks for single-process access.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { GithubTokenCacheRepository } from "../github-token-cache.repository.ts";
import { MemoryGithubTokenCacheRepository } from "../memory/memory.github-token-cache.repository.ts";
import { MemoryGithubDatabase } from "../memory/memory.github.database.ts";

const INSTALLATION = "42";
const OTHER_INSTALLATION = "43";
const SCOPE = "scope-a";
const OTHER_SCOPE = "scope-b";

const backends: readonly Readonly<{ name: string; create: () => GithubTokenCacheRepository }>[] = [
  {
    name: "memory",
    create: () =>
      MemoryGithubTokenCacheRepository.create({ memory: MemoryGithubDatabase.create() }),
  },
];

describe.each(backends)("given the $name installation-token cache", (backend) => {
  let cache: GithubTokenCacheRepository;

  beforeEach(() => {
    cache = backend.create();
  });

  describe("when a token has been stored", () => {
    beforeEach(async () => {
      await cache.storeToken({
        installationId: INSTALLATION,
        scopeKey: SCOPE,
        token: "ghs_one",
        ttlSec: 60,
      });
    });

    it("reads the token back under the same scope", async () => {
      await expect(
        cache.findToken({ installationId: INSTALLATION, scopeKey: SCOPE }),
      ).resolves.toBe("ghs_one");
    });

    it("answers nothing for another scope of the same installation", async () => {
      await expect(
        cache.findToken({ installationId: INSTALLATION, scopeKey: OTHER_SCOPE }),
      ).resolves.toBeNull();
    });

    it("answers nothing for another installation", async () => {
      await expect(
        cache.findToken({ installationId: OTHER_INSTALLATION, scopeKey: SCOPE }),
      ).resolves.toBeNull();
    });
  });

  describe("when nothing has been stored", () => {
    it("answers nothing for the token", async () => {
      await expect(
        cache.findToken({ installationId: INSTALLATION, scopeKey: SCOPE }),
      ).resolves.toBeNull();
    });

    it("answers that the installation has no liveness verdict", async () => {
      await expect(cache.hasLiveness(INSTALLATION)).resolves.toBe(false);
    });
  });

  describe("when a token was stored with an elapsed lifetime", () => {
    it("answers nothing, the way an expired key does", async () => {
      await cache.storeToken({
        installationId: INSTALLATION,
        scopeKey: SCOPE,
        token: "ghs_stale",
        ttlSec: 0,
      });

      await expect(
        cache.findToken({ installationId: INSTALLATION, scopeKey: SCOPE }),
      ).resolves.toBeNull();
    });
  });

  describe("when a liveness verdict has been marked", () => {
    it("answers that the installation has one", async () => {
      await cache.markLiveness({ installationId: INSTALLATION, value: "alive", ttlSec: 60 });

      await expect(cache.hasLiveness(INSTALLATION)).resolves.toBe(true);
      await expect(cache.hasLiveness(OTHER_INSTALLATION)).resolves.toBe(false);
    });

    it("answers that a backoff verdict is a verdict too", async () => {
      await cache.markLiveness({ installationId: INSTALLATION, value: "backoff", ttlSec: 60 });

      await expect(cache.hasLiveness(INSTALLATION)).resolves.toBe(true);
    });
  });

  describe("when the mint lock is held", () => {
    it("refuses a second holder until the first releases it", async () => {
      const key = { installationId: INSTALLATION, scopeKey: SCOPE };
      const first = await cache.acquireMintLock(key);
      if (!first.acquired) throw new Error("the first holder did not get the mint lock");

      await expect(cache.acquireMintLock(key)).resolves.toEqual({ acquired: false });

      await cache.releaseMintLock({ ...key, token: first.token });
      await expect(cache.acquireMintLock(key)).resolves.toMatchObject({ acquired: true });
    });

    it("leaves another scope's lock free", async () => {
      await cache.acquireMintLock({ installationId: INSTALLATION, scopeKey: SCOPE });

      await expect(
        cache.acquireMintLock({ installationId: INSTALLATION, scopeKey: OTHER_SCOPE }),
      ).resolves.toMatchObject({ acquired: true });
    });
  });

  describe("when the liveness lock is held", () => {
    it("refuses a second holder until the first releases it", async () => {
      const first = await cache.acquireLivenessLock(INSTALLATION);
      if (!first.acquired) throw new Error("the first holder did not get the liveness lock");

      await expect(cache.acquireLivenessLock(INSTALLATION)).resolves.toEqual({ acquired: false });

      await cache.releaseLivenessLock({ installationId: INSTALLATION, token: first.token });
      await expect(cache.acquireLivenessLock(INSTALLATION)).resolves.toMatchObject({
        acquired: true,
      });
    });

    it("keeps a holder that does not own the lock from releasing it", async () => {
      await cache.acquireLivenessLock(INSTALLATION);

      await cache.releaseLivenessLock({ installationId: INSTALLATION, token: "someone-else" });

      await expect(cache.acquireLivenessLock(INSTALLATION)).resolves.toEqual({ acquired: false });
    });
  });
});
