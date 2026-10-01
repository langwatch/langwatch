/**
 * The one run-key mint: the starter's own key, as narrow as the run, never wider than what they
 * hold, and reused only while it covers the caller's floor.
 *
 * @see modules/workflow/specs/workflow-service.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  RUN_KEY_LIFETIME_MS,
  RUN_KEY_MAX_REMAINING_MS,
  type ApiKeyApi,
} from "@langwatch/api-key-contract";
import { type AuthzApi, authzEffectivePermissionsOutputSchema } from "@langwatch/authz-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RUN_KEY_REUSE_MARGIN_MS } from "../../rules/run-key.rules.ts";
import { RunKeyMintService } from "../run-key-mint.service.ts";

const projectId = "project-1";
const starter = "user-1";

function createService(initiallyHeld: readonly string[], keyHeld: readonly string[] = []) {
  let held = [...initiallyHeld];
  const created: Parameters<ApiKeyApi["create"]>[0][] = [];
  const create = vi.fn();
  create.mockImplementation(async (input: Parameters<ApiKeyApi["create"]>[0]) => {
    created.push(input);

    return { token: `token-${created.length}`, apiKey: { id: `key-${created.length}` } };
  });
  const apiKeys = createApiFixture<ApiKeyApi>({ create });
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

  return {
    service: RunKeyMintService.create({ apiKeys, authz }),
    created,
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
    ).rejects.toThrow();
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
});
