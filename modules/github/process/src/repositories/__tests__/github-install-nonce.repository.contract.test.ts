/**
 * Installation nonce contract: register once, consume once to prevent replayed
 * Setup URLs from recording installations twice.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { GithubInstallNonceRepository } from "../github-install-nonce.repository.ts";
import { MemoryGithubInstallNonceRepository } from "../memory/memory.github-install-nonce.repository.ts";
import { MemoryGithubDatabase } from "../memory/memory.github.database.ts";

const NONCE = "nonce-one";
const OTHER_NONCE = "nonce-two";

const backends: readonly Readonly<{ name: string; create: () => GithubInstallNonceRepository }>[] =
  [
    {
      name: "memory",
      create: () =>
        MemoryGithubInstallNonceRepository.create({ memory: MemoryGithubDatabase.create() }),
    },
  ];

describe.each(backends)("given the $name installation nonces", (backend) => {
  let nonces: GithubInstallNonceRepository;

  beforeEach(() => {
    nonces = backend.create();
  });

  describe("when a nonce has been registered", () => {
    beforeEach(async () => {
      const registered = await nonces.registerNonce({ nonce: NONCE, ttlSec: 600 });
      if (!registered) throw new Error("setup: the nonce was not registered");
    });

    it("consumes it once", async () => {
      await expect(nonces.consumeNonce(NONCE)).resolves.toBe("consumed");
    });

    it("refuses the second consume of the same nonce", async () => {
      await nonces.consumeNonce(NONCE);

      await expect(nonces.consumeNonce(NONCE)).resolves.toBe("spent");
    });

    it("leaves another nonce untouched", async () => {
      await nonces.consumeNonce(NONCE);

      await expect(nonces.consumeNonce(OTHER_NONCE)).resolves.toBe("spent");
    });
  });

  describe("when the nonce was never registered", () => {
    it("refuses to consume it", async () => {
      await expect(nonces.consumeNonce(NONCE)).resolves.toBe("spent");
    });
  });

  describe("when the nonce's lifetime has elapsed", () => {
    it("refuses to consume it", async () => {
      await nonces.registerNonce({ nonce: NONCE, ttlSec: 0 });

      await expect(nonces.consumeNonce(NONCE)).resolves.toBe("spent");
    });
  });
});
