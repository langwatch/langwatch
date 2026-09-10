/**
 * The installation nonce's contract: a nonce is registered for a lifetime and
 * taken exactly once, so a replayed Setup URL cannot record an installation
 * twice.
 *
 * The memory twin is the only backend registered here. The Redis twin answers
 * null for every operation on a process that opened no connection, which
 * `../../services/__tests__/github-install-state.service.unit.test.ts` drives
 * directly, because "no store" is not a state the memory twin can be in.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { GithubInstallNonceRepository } from "../github-install-nonce.repository.ts";
import { MemoryGithubDatabase } from "../memory/memory.github.database.ts";
import { MemoryGithubInstallNonceRepository } from "../memory/memory.github-install-nonce.repository.ts";

const NONCE = "nonce-one";
const OTHER_NONCE = "nonce-two";

const backends: ReadonlyArray<
  Readonly<{ name: string; create: () => GithubInstallNonceRepository }>
> = [
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
      await expect(nonces.registerNonce({ nonce: NONCE, ttlSec: 600 })).resolves.toBe(true);
    });

    it("consumes it once", async () => {
      await expect(nonces.consumeNonce(NONCE)).resolves.toBe(true);
    });

    it("refuses the second consume of the same nonce", async () => {
      await nonces.consumeNonce(NONCE);

      await expect(nonces.consumeNonce(NONCE)).resolves.toBe(false);
    });

    it("leaves another nonce untouched", async () => {
      await nonces.consumeNonce(NONCE);

      await expect(nonces.consumeNonce(OTHER_NONCE)).resolves.toBe(false);
    });
  });

  describe("when the nonce was never registered", () => {
    it("refuses to consume it", async () => {
      await expect(nonces.consumeNonce(NONCE)).resolves.toBe(false);
    });
  });

  describe("when the nonce's lifetime has elapsed", () => {
    it("refuses to consume it", async () => {
      await nonces.registerNonce({ nonce: NONCE, ttlSec: 0 });

      await expect(nonces.consumeNonce(NONCE)).resolves.toBe(false);
    });
  });
});
