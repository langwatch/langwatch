import type { CreateHeldApiKeyInput } from "@langwatch/api-key-contract";
import { AuthzGrantNotConfirmedError } from "@langwatch/authz-contract";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { Temporal, nowInstant } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyRow } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import type { DisabledApiKey } from "../api-key-lifecycle.service.ts";
import { HELD_KEY_GRANT_RETRY_AFTER_MS, HeldKeyMintService } from "../held-key-mint.service.ts";

const GRANT_WAIT_MS = 10_000;
const MAX_ATTEMPTS = 4;

const keyInput = (userId = "user-1"): CreateHeldApiKeyInput["key"] => ({
  isSystemManaged: true,
  name: "Langy session",
  description: "test",
  userId,
  createdByUserId: userId,
  organizationId: "org-1",
  permissionMode: "restricted",
  permissions: ["traces:view"],
  bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project-1" }],
  expiresAt: new Date("2026-10-01T16:00:00.000Z"),
});

/** Key writer over the memory repository; its grant lands once the clock reaches `landsAtMs`. */
function createFixture({
  landsAtMs,
  beforeActivate,
}: {
  landsAtMs: number;
  beforeActivate?: (row: ApiKeyRow) => void;
}) {
  const start = Date.now();
  const memory = MemoryApiKeyDatabase.create();
  const repository = MemoryApiKeyRepository.create({ memory });
  const disabled = (
    id: string,
    token: string,
    input: CreateHeldApiKeyInput["key"],
  ): DisabledApiKey => ({
    id,
    token,
    organizationId: "org-1",
    bindings: input.bindings,
    permissions: input.permissions,
    actor: { type: "user", id: "user-1" },
    caller: { type: "system" },
  });
  const apiKeys = {
    writeDisabled: async (input: CreateHeldApiKeyInput["key"]) => {
      const row = await repository.create({
        name: input.name,
        description: null,
        lookupId: `lookup-${Math.random()}`,
        hashedSecret: "hash",
        permissionMode: "restricted",
        userId: input.userId ?? null,
        createdByUserId: input.userId ?? null,
        organizationId: "org-1",
        expiresAt: Temporal.Instant.fromEpochMilliseconds(input.expiresAt.getTime()),
        ingestSourceType: null,
        ingestionTemplateId: null,
        startsDisabled: true,
        grants: [],
      });
      return disabled(row.id, `token-${row.id}`, input);
    },
    reopenDisabled: async ({
      id,
      token,
      input,
    }: {
      id: string;
      token: string;
      input: CreateHeldApiKeyInput["key"];
    }) => disabled(id, token, input),
    grantAndActivate: async (key: DisabledApiKey) => {
      // The real grant waits out the authz fold before it gives up.
      await vi.advanceTimersByTimeAsync(GRANT_WAIT_MS);
      if (Date.now() - start < landsAtMs) throw new AuthzGrantNotConfirmedError();
      const row = await repository.findById({ id: key.id });
      if (row) beforeActivate?.(row);
      await repository.activate({ id: key.id });
      return { token: key.token };
    },
  };
  return {
    repository,
    memory,
    rows: () => memory.keys(),
    service: HeldKeyMintService.create({
      apiKeys,
      keys: repository,
      held: MemorySharedCredentialStore.create(),
    }),
  };
}

type Service = ReturnType<typeof createFixture>["service"];

/** The outbox's retry: the same call again after the delay the error asks for. */
async function attempts(run: () => ReturnType<Service["createHeld"]>) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !(error instanceof AuthzGrantNotConfirmedError)) throw error;
      await vi.advanceTimersByTimeAsync(error.retryAfterMs ?? 0);
    }
  }
}

/**
 * @see modules/api-key/specs/api-key.feature
 * @scenario "A held key is written once and handed to a retry with its pending grant"
 * @scenario "A held key is never handed to another person"
 * @scenario "A held key that was revoked or has lapsed is minted over"
 * @scenario "A held key revoked before it is activated stays revoked"
 * @scenario "A released held key is minted fresh"
 */
describe("HeldKeyMintService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the run proceed when the grant lands 45 s after it was written", async () => {
    const { service } = createFixture({ landsAtMs: 45_000 });

    const key = await attempts(() => service.createHeld({ holdKey: "run-1", key: keyInput() }));

    expect(key.token).toMatch(/^token-/);
  });

  it("asks the outbox to retry at the held key's own pace", async () => {
    const { service } = createFixture({ landsAtMs: 45_000 });

    const error = await service
      .createHeld({ holdKey: "run-1", key: keyInput() })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ retryable: true, retryAfterMs: HELD_KEY_GRANT_RETRY_AFTER_MS });
  });

  it("reuses the held key on a retry: one key exists, with the same id", async () => {
    const { service, rows } = createFixture({ landsAtMs: 45_000 });
    await service.createHeld({ holdKey: "run-1", key: keyInput() }).catch(() => undefined);
    expect(rows()).toHaveLength(1);

    const second = await attempts(() => service.createHeld({ holdKey: "run-1", key: keyInput() }));

    expect(rows()).toHaveLength(1);
    // The first try only wrote the key; the retry that activated it is the one mint.
    expect(second).toMatchObject({ apiKeyId: rows()[0]?.id, created: true });
  });

  it("reports the call that activated the key as the one that created it", async () => {
    const { service } = createFixture({ landsAtMs: 0 });

    const first = await service.createHeld({ holdKey: "run-1", key: keyInput() });
    const again = await service.createHeld({ holdKey: "run-1", key: keyInput() });

    expect(first.created).toBe(true);
    expect(again).toEqual({ ...first, created: false });
  });

  it("mints a fresh key when the held one was revoked", async () => {
    const { service, rows, repository } = createFixture({ landsAtMs: 0 });
    const first = await service.createHeld({ holdKey: "run-1", key: keyInput() });
    await repository.update({ id: first.apiKeyId, revokedAt: nowInstant() });

    const next = await service.createHeld({ holdKey: "run-1", key: keyInput() });

    expect(next.apiKeyId).not.toBe(first.apiKeyId);
    expect(rows()).toHaveLength(2);
  });

  it("mints a fresh key when the held one has too little life left to serve the caller", async () => {
    const { service } = createFixture({ landsAtMs: 0 });
    const soon = { ...keyInput(), expiresAt: new Date(Date.now() + 30_000) };
    const first = await service.createHeld({ holdKey: "run-1", key: soon });

    const next = await service.createHeld({ holdKey: "run-1", key: keyInput() });

    expect(next.apiKeyId).not.toBe(first.apiKeyId);
  });

  it("mints over a key revoked after it was activated, on the retry", async () => {
    const { service, rows, repository } = createFixture({ landsAtMs: 0 });
    const first = await service.createHeld({ holdKey: "run-1", key: keyInput() });
    await repository.revoke({ id: first.apiKeyId, organizationId: "org-1", cause: "user" });

    const next = await attempts(() => service.createHeld({ holdKey: "run-1", key: keyInput() }));

    expect(next.apiKeyId).not.toBe(first.apiKeyId);
    expect(rows()).toHaveLength(2);
  });

  it("never undoes a revoke that lands before the key is activated", async () => {
    const { service, rows, memory } = createFixture({
      landsAtMs: 0,
      beforeActivate: (row) => memory.replaceKey({ ...row, revocationCause: "user" }),
    });

    const error = await service
      .createHeld({ holdKey: "run-1", key: keyInput() })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ retryable: true });
    expect(rows()[0]).toMatchObject({ revocationCause: "user" });
    expect(rows()[0]?.revokedAt).not.toBeNull();
  });

  it("mints a fresh key after the held entry is released", async () => {
    const { service } = createFixture({ landsAtMs: 0 });
    const first = await service.createHeld({ holdKey: "run-1", key: keyInput() });
    await service.release({ organizationId: "org-1", holdKey: "run-1" });

    const next = await service.createHeld({ holdKey: "run-1", key: keyInput() });

    expect(next.apiKeyId).not.toBe(first.apiKeyId);
  });

  it("never hands one user's held key to another user", async () => {
    const { service } = createFixture({ landsAtMs: 0 });
    const first = await service.createHeld({ holdKey: "run-1", key: keyInput("user-1") });

    const other = await service.createHeld({ holdKey: "run-1", key: keyInput("user-2") });

    expect(other.apiKeyId).not.toBe(first.apiKeyId);
  });
});
