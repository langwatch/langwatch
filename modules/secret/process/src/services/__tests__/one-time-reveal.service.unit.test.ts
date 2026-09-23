/**
 * The one-time reveal, over the memory twin of the store a deployment runs
 * on. Spec: modules/secret/specs/one-time-reveal.feature.
 */
import { ONE_TIME_REVEAL_TTL_MS } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";

import { ReversibleTestSecretEncryption } from "../../app/__tests__/secret.fixture.ts";
import { MemoryOneTimeRevealRepository } from "../../repositories/memory/memory.one-time-reveal.repository.ts";
import { OneTimeRevealService } from "../one-time-reveal.service.ts";

const STASH = {
  organizationId: "org_acme",
  kind: "virtual_key" as const,
  keyId: "vk_1",
  preview: "sk-…4f2a",
  secret: "sk-live-9f2c",
};

function fixture() {
  let nowMs = 1_700_000_000_000;
  const store = MemoryOneTimeRevealRepository.create({ nowMs: () => nowMs });

  return {
    store,
    pass: (ms: number) => {
      nowMs += ms;
    },
    service: OneTimeRevealService.create({
      store,
      encryption: new ReversibleTestSecretEncryption(),
    }),
  };
}

/** The code of a handled failure, or the error itself when it is not one. */
async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return (error as { code?: unknown }).code ?? error;
  }

  return null;
}

describe("the one-time reveal", () => {
  /** @scenario "The first read returns the secret and the second refuses" */
  it("serves the secret once and refuses every read after it", async () => {
    const { service, store } = fixture();

    const { revealId } = await service.stash(STASH);
    // Sealed at rest: what the store holds went through the cipher, so a dump
    // of it is not a list of plaintext credentials.
    const parked = await store.take({ organizationId: STASH.organizationId, revealId });
    if (!parked.taken) throw new Error("the stash parked nothing");
    expect(parked.reveal.sealed).toBe(new ReversibleTestSecretEncryption().encrypt(STASH.secret));
    expect(parked.reveal.sealed).not.toBe(STASH.secret);
    await store.put({
      organizationId: STASH.organizationId,
      revealId,
      reveal: parked.reveal,
      ttlMs: ONE_TIME_REVEAL_TTL_MS,
    });

    await expect(
      service.reveal({ organizationId: STASH.organizationId, revealId }),
    ).resolves.toEqual({
      kind: "virtual_key",
      keyId: "vk_1",
      preview: "sk-…4f2a",
      secret: STASH.secret,
    });

    expect(
      await codeOf(() => service.reveal({ organizationId: STASH.organizationId, revealId })),
    ).toBe("secret_already_revealed");
  });

  /** @scenario "A reveal id that never existed or has expired is refused" */
  it("refuses an id nobody ever stashed", async () => {
    const { service } = fixture();

    expect(
      await codeOf(() =>
        service.reveal({ organizationId: STASH.organizationId, revealId: "rvl_invented" }),
      ),
    ).toBe("secret_reveal_expired");
  });

  /** @scenario "A reveal belongs to the organization that stashed it" */
  it("does not serve one organization's reveal to another", async () => {
    const { service } = fixture();

    const { revealId } = await service.stash(STASH);

    expect(await codeOf(() => service.reveal({ organizationId: "org_other", revealId }))).toBe(
      "secret_reveal_expired",
    );
    // And the near miss consumed nothing: the owner's read still works.
    await expect(
      service.reveal({ organizationId: STASH.organizationId, revealId }),
    ).resolves.toMatchObject({ secret: STASH.secret });
  });

  /** @scenario "A reveal left unread past its window is gone" */
  it("forgets a reveal nobody read inside its window", async () => {
    const { service, pass } = fixture();

    const { revealId } = await service.stash(STASH);
    pass(ONE_TIME_REVEAL_TTL_MS + 1);

    expect(
      await codeOf(() => service.reveal({ organizationId: STASH.organizationId, revealId })),
    ).toBe("secret_reveal_expired");
  });
});
