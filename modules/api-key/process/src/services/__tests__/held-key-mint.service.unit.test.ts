import type { CreateHeldApiKeyInput } from "@langwatch/api-key-contract";
import { AuthzGrantNotConfirmedError } from "@langwatch/authz-contract";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyRow } from "../../repositories/api-key.repository.ts";
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

/** In-memory key writer whose grant lands once the fake clock reaches `landsAtMs`. */
function createFixture({ landsAtMs }: { landsAtMs: number }) {
  const start = Date.now();
  const rows = new Map<string, { revokedAt: Date | null }>();
  const disabled = (id: string, token: string): DisabledApiKey => ({
    id,
    token,
    organizationId: "org-1",
    bindings: keyInput().bindings,
    permissions: keyInput().permissions,
    actor: { type: "user", id: "user-1" },
    caller: { type: "system" },
  });
  const apiKeys = {
    writeDisabled: async () => {
      const key = disabled(`key-${rows.size + 1}`, `token-${rows.size + 1}`);
      rows.set(key.id, { revokedAt: null });
      return key;
    },
    reopenDisabled: async ({ id, token }: { id: string; token: string }) => disabled(id, token),
    grantAndActivate: async (key: DisabledApiKey) => {
      // The real grant waits out the authz fold before it gives up.
      await vi.advanceTimersByTimeAsync(GRANT_WAIT_MS);
      if (Date.now() - start < landsAtMs) throw new AuthzGrantNotConfirmedError();
      return { token: key.token };
    },
  };
  const keys = {
    findById: async ({ id }: { id: string }) => {
      const row = rows.get(id);
      return row ? ({ revokedAt: row.revokedAt, expiresAt: null } as unknown as ApiKeyRow) : null;
    },
  };
  return {
    rows,
    service: HeldKeyMintService.create({
      apiKeys,
      keys,
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
    expect(rows.size).toBe(1);

    const second = await attempts(() => service.createHeld({ holdKey: "run-1", key: keyInput() }));

    expect(rows.size).toBe(1);
    // The first try only wrote the key; the retry that activated it is the one mint.
    expect(second).toMatchObject({ apiKeyId: "key-1", created: true });
  });

  it("reports the call that activated the key as the one that created it", async () => {
    const { service } = createFixture({ landsAtMs: 0 });

    const first = await service.createHeld({ holdKey: "run-1", key: keyInput() });
    const again = await service.createHeld({ holdKey: "run-1", key: keyInput() });

    expect(first.created).toBe(true);
    expect(again).toEqual({ ...first, created: false });
  });

  it("mints a fresh key when the held one was revoked", async () => {
    const { service, rows } = createFixture({ landsAtMs: 0 });
    const first = await service.createHeld({ holdKey: "run-1", key: keyInput() });
    rows.set(first.apiKeyId, { revokedAt: new Date() });

    const next = await service.createHeld({ holdKey: "run-1", key: keyInput() });

    expect(next.apiKeyId).not.toBe(first.apiKeyId);
    expect(rows.size).toBe(2);
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
