/** Main's `applySessionCeiling` (cli-login-key-reaper.ts). Spec: modules/api-key/specs */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRow } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyBindingIdService } from "../api-key-binding-id.service.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";
import { ApiKeyService } from "../api-key.service.ts";
import { LegacyApiKeyGrantService } from "../legacy-api-key-grant.service.ts";

const ORG_ID = "org_1";
const DAY_MS = 24 * 60 * 60 * 1000;

function loginKey({
  id,
  startedDaysAgo,
  expiresInMs,
}: {
  id: string;
  startedDaysAgo: number;
  expiresInMs: number;
}): ApiKeyRow {
  const now = Date.now();
  return {
    id,
    name: `CLI login - ${id}`,
    description: null,
    organizationId: ORG_ID,
    userId: "user_1",
    createdByUserId: "user_1",
    createdByDeviceLabel: id,
    parentApiKeyId: null,
    permissionMode: "restricted",
    expiresAt: new Date(now + expiresInMs),
    revokedAt: null,
    revocationCause: null,
    lookupId: `lookup_${id}`,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date(now - startedDaysAgo * DAY_MS),
    updatedAt: new Date(now),
    hashedSecret: "hashed",
  };
}

function setup(rows: ApiKeyRow[], options: { childrenUnreadable?: boolean } = {}) {
  const database = MemoryApiKeyDatabase.create();
  for (const row of rows) database.replaceKey(row);
  const memory = MemoryApiKeyRepository.create({ memory: database });
  const repository = options.childrenUnreadable
    ? Object.assign(memory, {
        findLiveChildren: vi.fn(async () => {
          throw new Error("children unreadable");
        }),
      })
    : memory;
  const authz = createApiFixture<AuthzApi>({ listApiKeyBindings: vi.fn(async () => []) });
  const grants = createApiFixture<AuthzApi>({ revokeBindingsWhere: vi.fn(async () => 0) });
  const service = ApiKeyService.create({
    repository,
    authz,
    grants,
    organizations: createApiFixture<OrganizationApi>({}),
    projects: createApiFixture<ProjectApi>({}),
    bindingIds: ApiKeyBindingIdService.create(),
    legacyGrants: LegacyApiKeyGrantService.create({
      authz,
      grants,
      deriveBindingId: vi.fn(),
      diagnostics: createTestLogger().logger,
    }),
    tokens: ApiKeyTokenService.create("pepper"),
  });
  const row = (id: string) => database.keys().find((key) => key.id === id);
  return { service, row };
}

describe("ApiKeyService.applySessionCeiling", () => {
  describe("given live login keys and a tightened ceiling", () => {
    /** @scenario "Tightening the organization's session ceiling brings live login keys forward and retires elapsed ones" */
    it("lowers each expiry to the ceiling and reaps the keys already past it", async () => {
      const recent = loginKey({ id: "recent", startedDaysAgo: 2, expiresInMs: 20 * DAY_MS });
      const old = loginKey({ id: "old", startedDaysAgo: 10, expiresInMs: 20 * DAY_MS });
      const { service, row } = setup([recent, old]);

      const reaped = await service.applySessionCeiling({
        organizationId: ORG_ID,
        maxSessionDurationDays: 7,
      });

      expect(reaped).toBe(1);
      expect(row("recent")?.expiresAt?.getTime()).toBe(recent.createdAt.getTime() + 7 * DAY_MS);
      expect(row("recent")?.revokedAt).toBeNull();
      expect(row("old")?.revocationCause).toBe("expired");
    });
  });

  describe("given a ceiling of zero", () => {
    /** @scenario "Clearing the session ceiling leaves refresh windows alone and still retires elapsed login keys" */
    it("keeps live expiries and still reaps the elapsed key", async () => {
      const live = loginKey({ id: "live", startedDaysAgo: 30, expiresInMs: 20 * DAY_MS });
      const elapsed = loginKey({ id: "elapsed", startedDaysAgo: 1, expiresInMs: -60_000 });
      const { service, row } = setup([live, elapsed]);

      const reaped = await service.applySessionCeiling({
        organizationId: ORG_ID,
        maxSessionDurationDays: 0,
      });

      expect(reaped).toBe(1);
      expect(row("live")?.expiresAt?.getTime()).toBe(live.expiresAt?.getTime());
      expect(row("elapsed")?.revocationCause).toBe("expired");
    });
  });

  describe("given an elapsed key whose ingest keys cannot be read", () => {
    /** @scenario "A login key retired by the session ceiling counts even when its ingest keys cannot be read" */
    it("still counts the login key, as main's revokeQuietly did", async () => {
      const elapsed = loginKey({ id: "elapsed", startedDaysAgo: 1, expiresInMs: -60_000 });
      const { service, row } = setup([elapsed], { childrenUnreadable: true });

      const reaped = await service.applySessionCeiling({
        organizationId: ORG_ID,
        maxSessionDurationDays: 0,
      });

      expect(reaped).toBe(1);
      expect(row("elapsed")?.revocationCause).toBe("expired");
    });
  });
});
