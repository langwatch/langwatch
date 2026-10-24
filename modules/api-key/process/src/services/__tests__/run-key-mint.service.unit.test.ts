import { RUN_KEY_MAX_REMAINING_MS, type CreateApiKeyInput } from "@langwatch/api-key-contract";
import {
  AuthzGrantNotConfirmedError,
  type AuthzApi,
  authzEffectivePermissionsOutputSchema,
} from "@langwatch/authz-contract";
/**
 * The one run-key mint: the starter's own key, as narrow as the run, never wider than what they
 * hold, and reused only while it covers the caller's floor.
 *
 * @see modules/workflow/specs/workflow-service.feature
 * @see modules/api-key/specs/api-key.feature
 */
import {
  MemorySharedCredentialStore,
  type SharedCredentialStore,
} from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { RUN_KEY_LIFETIME_MS, RUN_KEY_REUSE_MARGIN_MS } from "../../rules/run-key.rules.ts";
import type { DisabledApiKey } from "../api-key-lifecycle.service.ts";
import { RunKeyMintService } from "../run-key-mint.service.ts";

const projectId = "project-1";
const starter = "user-1";

type Grant = "lands" | "pending" | "refused";
type RunKeyWriter = Parameters<typeof RunKeyMintService.create>[0]["apiKeys"];

function createService(
  initiallyHeld: readonly string[],
  keyHeld: readonly string[] = [],
  shared: SharedCredentialStore = MemorySharedCredentialStore.create(),
) {
  let held = [...initiallyHeld];
  let grant: Grant = "lands";
  const created: CreateApiKeyInput[] = [];
  const granted: string[] = [];
  const disabledKey = ({
    id,
    token,
    input,
  }: {
    id: string;
    token: string;
    input: CreateApiKeyInput;
  }) =>
    ({
      id,
      token,
      organizationId: input.organizationId,
      bindings: input.bindings,
      permissions: input.permissions,
      actor: { type: "user", id: input.userId ?? null },
      caller: { type: "system" },
    }) satisfies DisabledApiKey;
  const writeDisabled: RunKeyWriter["writeDisabled"] = vi.fn(async (input) => {
    created.push(input);
    return disabledKey({ id: `key-${created.length}`, token: `token-${created.length}`, input });
  });
  const reopenDisabled: RunKeyWriter["reopenDisabled"] = vi.fn(async (reopened) =>
    disabledKey(reopened),
  );
  const grantAndActivate: RunKeyWriter["grantAndActivate"] = vi.fn(async (key) => {
    granted.push(key.id);
    if (grant === "pending") throw new AuthzGrantNotConfirmedError();
    if (grant === "refused") throw new Error("the ledger refused the write");

    return { token: key.token };
  });
  const effectivePermissions: AuthzApi["effectivePermissions"] = vi.fn(
    async ({ principal }: Parameters<AuthzApi["effectivePermissions"]>[0]) =>
      authzEffectivePermissionsOutputSchema.parse(principal.type === "apiKey" ? keyHeld : held),
  );
  const authz = createApiFixture<AuthzApi>({
    getScope: vi.fn().mockResolvedValue({
      type: "project",
      id: projectId,
      teamId: "team-1",
      organizationId: "org-1",
    }),
    effectivePermissions,
  });
  const apiKeys: RunKeyWriter = { writeDisabled, reopenDisabled, grantAndActivate };

  return {
    service: RunKeyMintService.create({ apiKeys, authz, held: shared }),
    created,
    granted,
    grantWill: (next: Grant) => {
      grant = next;
    },
    revoke: (permission: string) => {
      held = held.filter((candidate) => candidate !== permission);
    },
  };
}

describe("RunKeyMintService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "A workflow run calls LangWatch with a key minted for that run, never the project key" */
  /** @scenario "The run's key stops working after the run ends" */
  /** @scenario "Every call a run makes back into LangWatch acts as the user who started it" */
  it("mints a restricted, project-bound key owned by the starter that expires in 15 minutes", async () => {
    const { service, created } = createService(["traces:create", "evaluations:manage"]);

    await service.mintRunKey({ userId: starter, projectId, permissions: ["traces:create"] });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      isSystemManaged: true,
      name: "Workflow run",
      userId: "user-1",
      createdByUserId: "user-1",
      organizationId: "org-1",
      permissionMode: "restricted",
      permissions: ["traces:create"],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
    });
    expect(created[0]?.expiresAt?.getTime()).toBe(
      new Date("2026-10-01T10:00:00.000Z").getTime() + RUN_KEY_LIFETIME_MS,
    );
  });

  /** @scenario "A run is refused before it starts when its starter may not run evaluations" */
  it("refuses, and mints nothing, when the starter lacks a needed permission", async () => {
    const { service, created } = createService(["traces:create"]);

    await expect(
      service.mintRunKey({
        userId: starter,
        projectId,
        permissions: ["traces:create", "evaluations:manage"],
      }),
    ).rejects.toMatchObject({
      code: "api_key_permission_denied",
      meta: { permission: "evaluations:manage" },
    });
    expect(created).toHaveLength(0);
  });

  /** @scenario "A run started with a personal access token holds no more than that token" */
  it("refuses, and mints nothing, when the key the run was started with lacks a needed permission", async () => {
    const { service, created } = createService(
      ["traces:create", "workflows:manage"],
      ["traces:create"],
    );

    await expect(
      service.mintRunKey({
        userId: starter,
        callerApiKeyId: "pat-1",
        projectId,
        permissions: ["traces:create", "workflows:manage"],
      }),
    ).rejects.toMatchObject({
      code: "api_key_permission_denied",
      meta: { permission: "workflows:manage" },
    });
    expect(created).toHaveLength(0);
  });

  /** @scenario "The scenario canary starts its run as the probe's own API key" */
  it("mints traces:create for a run a member's key started, as a child of that key", async () => {
    const { service, created } = createService(["traces:create"], ["traces:create"]);

    await service.mintRunKey({
      userId: starter,
      callerApiKeyId: "probe-key-1",
      projectId,
      permissions: ["traces:create"],
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: starter,
      parentApiKeyId: "probe-key-1",
      permissions: ["traces:create"],
    });
  });

  /** @scenario "A run whose starter is no user on the project is refused its key" */
  it("refuses traces:create, and mints nothing, for a made-up starter that holds no permission", async () => {
    const { service, created } = createService([]);

    await expect(
      service.mintRunKey({ userId: "scenario-canary", projectId, permissions: ["traces:create"] }),
    ).rejects.toMatchObject({
      code: "api_key_permission_denied",
      meta: { permission: "traces:create" },
    });
    expect(created).toHaveLength(0);
  });

  /** @scenario "A run started with a service key holds no more than that key" */
  it("bounds an ownerless run a service key started by that key's permissions", async () => {
    const { service, created } = createService([], ["traces:create"]);

    await expect(
      service.mintRunKey({
        userId: null,
        callerApiKeyId: "service-key-1",
        projectId,
        permissions: ["traces:create", "evaluations:manage"],
      }),
    ).rejects.toMatchObject({ meta: { permission: "evaluations:manage" } });
    expect(created).toHaveLength(0);
  });

  /** @scenario "A run started with a service key acts as that key" */
  /** @scenario "A service key's run key is a child of the starting key" */
  it("mints an ownerless child of the starting service key, never lent to another starter", async () => {
    const { service, created } = createService([], ["traces:create"]);
    const permissions = ["traces:create"];

    const own = await service.mintRunKey({
      userId: null,
      callerApiKeyId: "service-key-1",
      projectId,
      permissions,
    });
    const other = await service.mintRunKey({
      userId: null,
      callerApiKeyId: "service-key-2",
      projectId,
      permissions,
    });
    const scheduled = await service.mintRunKey({ userId: null, projectId, permissions });

    expect(created[0]).toMatchObject({
      userId: null,
      createdByUserId: null,
      parentApiKeyId: "service-key-1",
      permissions,
    });
    expect(created[2]).toMatchObject({ parentApiKeyId: null });
    expect(new Set([own, other, scheduled]).size).toBe(3);
  });

  it("mints for a run whose starter and key both hold every needed permission", async () => {
    const { service, created } = createService(["traces:create"], ["traces:create"]);

    await service.mintRunKey({
      userId: starter,
      callerApiKeyId: "pat-1",
      projectId,
      permissions: ["traces:create"],
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ userId: starter, permissions: ["traces:create"] });
  });

  /** @scenario "A caller cannot ask for a run key that outlives an hour" */
  it("refuses a floor longer than an hour and mints nothing", async () => {
    const { service, created } = createService(["traces:create"]);

    await expect(
      service.mintRunKey({
        userId: starter,
        projectId,
        permissions: ["traces:create"],
        minRemainingMs: RUN_KEY_MAX_REMAINING_MS + 1,
      }),
    ).rejects.toThrow(ZodError);
    expect(created).toHaveLength(0);
  });

  /** @scenario "A long run keeps calling LangWatch past 15 minutes" */
  it("reuses a key for the same starter, project and permissions while enough life remains", async () => {
    const { service, created } = createService(["traces:create"]);
    const input = { userId: starter, projectId, permissions: ["traces:create"] };

    const first = await service.mintRunKey(input);
    vi.setSystemTime(Date.now() + RUN_KEY_LIFETIME_MS - RUN_KEY_REUSE_MARGIN_MS);
    const second = await service.mintRunKey(input);

    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  /** @scenario "A long run keeps calling LangWatch past 15 minutes" */
  it("mints a fresh key once less than the margin remains", async () => {
    const { service, created } = createService(["traces:create"]);
    const input = { userId: starter, projectId, permissions: ["traces:create"] };

    const first = await service.mintRunKey(input);
    vi.setSystemTime(Date.now() + RUN_KEY_LIFETIME_MS - RUN_KEY_REUSE_MARGIN_MS + 1);
    const second = await service.mintRunKey(input);

    expect(second).not.toBe(first);
    expect(created).toHaveLength(2);
  });

  it("never lends a broader key to a narrower run, or one starter's key to another", async () => {
    const { service, created } = createService(["traces:create", "evaluations:manage"]);

    const broad = await service.mintRunKey({
      userId: starter,
      projectId,
      permissions: ["traces:create", "evaluations:manage"],
    });
    const narrow = await service.mintRunKey({
      userId: starter,
      projectId,
      permissions: ["traces:create"],
    });
    const other = await service.mintRunKey({
      userId: "user-2",
      projectId,
      permissions: ["traces:create"],
    });

    expect(new Set([broad, narrow, other]).size).toBe(3);
    expect(created.map((input) => input.permissions)).toEqual([
      ["traces:create", "evaluations:manage"],
      ["traces:create"],
      ["traces:create"],
    ]);
  });

  /** @scenario "A run nobody started calls LangWatch with a project key holding only what it needs" */
  it("mints an ownerless, project-bound key holding exactly the permissions asked for", async () => {
    const { service, created } = createService([]);

    await service.mintRunKey({
      userId: null,
      projectId,
      permissions: ["traces:create", "evaluations:manage"],
    });

    expect(created[0]).toMatchObject({
      isSystemManaged: true,
      userId: null,
      createdByUserId: null,
      permissionMode: "restricted",
      permissions: ["traces:create", "evaluations:manage"],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
    });
  });

  /** @scenario "A run nobody started in a personal workspace acts as the system, not the owner" */
  it("never makes an ownerless key the workspace owner's, wherever the project is", async () => {
    const { service, created } = createService([]);

    await service.mintRunKey({ userId: null, projectId, permissions: ["traces:create"] });

    expect(created[0]).toMatchObject({ userId: null, createdByUserId: null });
  });

  /** @scenario "A starter who loses a permission is refused even while a key minted for them lives" */
  it("checks the starter's permissions again before handing out a held key", async () => {
    const { service, created, revoke } = createService(["traces:create", "evaluations:manage"]);
    const input = {
      userId: starter,
      projectId,
      permissions: ["traces:create", "evaluations:manage"],
    };

    await service.mintRunKey(input);
    revoke("evaluations:manage");

    await expect(service.mintRunKey(input)).rejects.toMatchObject({
      code: "api_key_permission_denied",
      meta: { permission: "evaluations:manage" },
    });
    expect(created).toHaveLength(1);
  });

  it("keeps an ownerless key apart from a starter's key of the same permissions", async () => {
    const { service, created } = createService(["traces:create"]);
    const permissions = ["traces:create"];

    const owned = await service.mintRunKey({ userId: starter, projectId, permissions });
    const ownerless = await service.mintRunKey({ userId: null, projectId, permissions });

    expect(ownerless).not.toBe(owned);
    expect(created).toHaveLength(2);
  });

  it("serves two runs that start together from one mint", async () => {
    const { service, created } = createService(["traces:create"]);
    const input = { userId: starter, projectId, permissions: ["traces:create"] };

    const [a, b] = await Promise.all([service.mintRunKey(input), service.mintRunKey(input)]);

    expect(a).toBe(b);
    expect(created).toHaveLength(1);
  });

  /** @scenario "A dispatch never holds a key that lapses before the dispatch can end" */
  it("mints afresh for a dispatch whose bound the held key no longer covers", async () => {
    const { service, created } = createService(["traces:create"]);
    const input = { userId: starter, projectId, permissions: ["traces:create"] };

    await service.mintRunKey(input);
    const lambdaFloorMs = 960_000;
    const bounded = await service.mintRunKey({ ...input, minRemainingMs: lambdaFloorMs });

    expect(created).toHaveLength(2);
    expect(created[1]?.expiresAt?.getTime()).toBe(
      new Date("2026-10-01T10:00:00.000Z").getTime() + lambdaFloorMs + RUN_KEY_REUSE_MARGIN_MS,
    );
    expect(await service.mintRunKey({ ...input, minRemainingMs: lambdaFloorMs })).toBe(bounded);
  });

  /** @scenario "A dispatch never holds a key that lapses before the dispatch can end" */
  it("mints a fresh key with a full lifetime for a caller with no bound of its own", async () => {
    const { service, created } = createService(["traces:create"]);
    const input = { userId: starter, projectId, permissions: ["traces:create"] };

    const fresh = await service.mintRunKey({ ...input, minRemainingMs: "fresh" });

    expect(created).toHaveLength(1);
    const mintedAtMs = new Date("2026-10-01T10:00:00.000Z").getTime();
    expect(created[0]?.expiresAt?.getTime()).toBe(
      mintedAtMs + RUN_KEY_LIFETIME_MS + RUN_KEY_REUSE_MARGIN_MS,
    );
    expect(await service.mintRunKey({ ...input, minRemainingMs: "fresh" })).toBe(fresh);
  });

  describe("given the grants projection is behind the run's first mint", () => {
    const input = { userId: starter, projectId, permissions: ["traces:create"] };

    /** @scenario "A run key whose grants have not landed answers that access is still processing" */
    it("answers the retryable 503 authz_grant_not_confirmed and hands out no token", async () => {
      const { service, grantWill } = createService(["traces:create"]);
      grantWill("pending");

      await expect(service.mintRunKey(input)).rejects.toMatchObject({
        code: "authz_grant_not_confirmed",
        httpStatus: 503,
        retryable: true,
      });
    });

    /** @scenario "A retried run key mint waits on the key the first attempt wrote" */
    it("grants the first attempt's key again rather than writing another", async () => {
      const { service, created, granted, grantWill } = createService(["traces:create"]);
      grantWill("pending");

      await expect(service.mintRunKey(input)).rejects.toMatchObject({
        code: "authz_grant_not_confirmed",
      });
      await expect(service.mintRunKey(input)).rejects.toMatchObject({
        code: "authz_grant_not_confirmed",
      });

      expect(created).toHaveLength(1);
      expect(granted).toEqual(["key-1", "key-1"]);
    });

    /** @scenario "A retried run key mint succeeds with the first attempt's key once its grants land" */
    it("hands out the first attempt's token once the grants land, and keeps serving it", async () => {
      const { service, created, grantWill } = createService(["traces:create"]);
      grantWill("pending");
      await expect(service.mintRunKey(input)).rejects.toMatchObject({
        code: "authz_grant_not_confirmed",
      });

      grantWill("lands");

      expect(await service.mintRunKey(input)).toBe("token-1");
      expect(await service.mintRunKey(input)).toBe("token-1");
      expect(created).toHaveLength(1);
    });

    /** @scenario "A pending run key past its usefulness is replaced, never activated" */
    it("writes a fresh key once the pending one no longer has the life the run needs", async () => {
      const { service, created, granted, grantWill } = createService(["traces:create"]);
      grantWill("pending");
      await expect(service.mintRunKey(input)).rejects.toMatchObject({
        code: "authz_grant_not_confirmed",
      });

      vi.advanceTimersByTime(RUN_KEY_LIFETIME_MS);
      grantWill("lands");

      expect(await service.mintRunKey(input)).toBe("token-2");
      expect(created).toHaveLength(2);
      expect(granted).toEqual(["key-1", "key-2"]);
    });

    it("passes a refused grant through unchanged, and its retry still writes no second key", async () => {
      const { service, created, grantWill } = createService(["traces:create"]);
      grantWill("refused");
      await expect(service.mintRunKey(input)).rejects.toThrow("the ledger refused the write");

      grantWill("lands");

      expect(await service.mintRunKey(input)).toBe("token-1");
      expect(created).toHaveLength(1);
    });
  });
});
