/**
 * `langwatch logout` retires the login key of the session that ended and the
 * ingest keys minted under it, and nothing a second machine holds.
 * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { newAuthzGrantId, type AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRow } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";
import { ApiKeyService } from "../api-key.service.ts";
import { LegacyApiKeyGrantService } from "../legacy-api-key-grant.service.ts";

const ORG_ID = "org_1";
const JANE = "user_jane";

function key({
  id,
  device,
  parentApiKeyId = null,
}: {
  id: string;
  device: string;
  parentApiKeyId?: string | null;
}): ApiKeyRow {
  const now = new Date();
  return {
    id,
    name: parentApiKeyId === null ? `CLI login - ${device}` : `claude_code - ${device}`,
    description: null,
    organizationId: ORG_ID,
    userId: JANE,
    createdByUserId: JANE,
    createdByDeviceLabel: device,
    parentApiKeyId,
    permissionMode: "restricted",
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    revocationCause: null,
    lookupId: `lookup_${id}`,
    lastUsedAt: null,
    ingestSourceType: parentApiKeyId === null ? null : "claude_code",
    ingestionTemplateId: null,
    createdAt: now,
    updatedAt: now,
    hashedSecret: "hashed",
  };
}

function janesTwoMachines() {
  const database = MemoryApiKeyDatabase.create();
  for (const row of [
    key({ id: "laptop_login", device: "laptop" }),
    key({ id: "laptop_ingest", device: "laptop", parentApiKeyId: "laptop_login" }),
    key({ id: "desktop_login", device: "desktop" }),
    key({ id: "desktop_ingest", device: "desktop", parentApiKeyId: "desktop_login" }),
  ]) {
    database.replaceKey(row);
  }
  const authz = createApiFixture<AuthzApi>({ listApiKeyBindings: vi.fn(async () => []) });
  const grants = createApiFixture<AuthzApi>({ revokeBindingsWhere: vi.fn(async () => 0) });
  const service = ApiKeyService.create({
    repository: MemoryApiKeyRepository.create({ memory: database }),
    answers: MemoryApiKeyAnswerCacheRepository.create(),
    authz,
    grants,
    organizations: createApiFixture<OrganizationApi>({}),
    projects: createApiFixture<ProjectApi>({}),
    bindingIds: { generateBindingId: newAuthzGrantId },
    legacyGrants: LegacyApiKeyGrantService.create({
      authz,
      grants,
      deriveBindingId: vi.fn(),
      diagnostics: createTestLogger().logger,
    }),
    tokens: ApiKeyTokenService.create("pepper"),
  });
  const row = (id: string) => database.keys().find((candidate) => candidate.id === id);
  return { service, row };
}

describe("ApiKeyService.revokeCliLoginKeyForLogout", () => {
  describe("given jane's laptop and desktop each hold a login key and a claude_code key", () => {
    /** @scenario Logging out retires the session's ingest keys and leaves another session's live */
    /** @scenario Logout retires the ingest keys this session minted */
    it("revokes the laptop's login key as user, its ingest key as session, and leaves the desktop's live", async () => {
      const { service, row } = janesTwoMachines();

      await service.revokeCliLoginKeyForLogout({
        apiKeyId: "laptop_login",
        userId: JANE,
        organizationId: ORG_ID,
      });

      expect(row("laptop_login")?.revocationCause).toBe("user");
      expect(row("laptop_ingest")?.revocationCause).toBe("session");
      expect(row("desktop_login")?.revokedAt).toBeNull();
      expect(row("desktop_ingest")?.revokedAt).toBeNull();
    });
  });
});
