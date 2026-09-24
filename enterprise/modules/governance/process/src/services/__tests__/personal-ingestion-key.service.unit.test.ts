// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The /me ingestion-key service over ApiKeyApi, pinned to main's ingestionKey.service.ts. */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  type ApiKey,
  type ApiKeyApi,
  ApiKeyAlreadyRevokedError,
} from "@langwatch/api-key-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { MemoryIngestionTemplateRepository } from "../../repositories/memory/memory.ingestion-template.repository.ts";
import { PersonalIngestionKeyService } from "../personal-ingestion-key.service.ts";

function apiKey(overrides: Partial<ApiKey>): ApiKey {
  return {
    id: "ak_1",
    name: "Ingestion key (cursor)",
    description: null,
    organizationId: "org_1",
    userId: "user_1",
    createdByUserId: "user_1",
    createdByDeviceLabel: null,
    parentApiKeyId: null,
    lookupId: "lookup_1",
    permissionMode: "restricted",
    expiresAt: null,
    revokedAt: null,
    revocationCause: null,
    lastUsedAt: null,
    ingestSourceType: "cursor",
    ingestionTemplateId: "tpl",
    createdAt: new Date(1_000),
    updatedAt: new Date(1_000),
    roleBindings: [],
    ...overrides,
  };
}

async function setup(keys: ApiKey[], revoke?: ApiKeyApi["revoke"]) {
  const templates = MemoryIngestionTemplateRepository.create(MemoryGovernanceStore.create());
  const template = await templates.createWithAudit({
    template: {
      slug: "cursor",
      sourceType: "cursor",
      displayName: "Cursor",
      description: null,
      iconAsset: null,
      credentialSchema: null,
      ottlRules: "",
      organizationId: "org_1",
    },
    callerUserId: "seed",
    surface: "hono",
  });
  const live = keys.map((key) =>
    key.ingestionTemplateId === "tpl" ? { ...key, ingestionTemplateId: template.id } : key,
  );
  const created: unknown[] = [];
  const revoked: string[] = [];
  const service = PersonalIngestionKeyService.create({
    templates,
    organizations: createApiFixture<OrganizationService>({
      getPersonalWorkspace: async () => ({
        team: { id: "team_p", name: "Personal", slug: "personal", createdAtMs: 0 },
        project: { id: "project_p", name: "Personal", slug: "p", apiKey: "k", createdAtMs: 0 },
      }),
    }),
    apiKeys: createApiFixture<ApiKeyApi>({
      findIngestionKeysForUser: async () => live,
      findById: async ({ id }) => live.find((key) => key.id === id) ?? null,
      create: async (input) => {
        created.push(input);
        return { token: "ik-lw-0123456789ab", apiKey: apiKey({ id: "ak_new" }) };
      },
      revoke:
        revoke ??
        (async ({ id }) => {
          revoked.push(id);
          return apiKey({ id });
        }),
    }),
  });
  const mint = { userId: "user_1", organizationId: "org_1", sourceType: "cursor" };
  return { service, created, revoked, mint: { ...mint, ingestionTemplateId: template.id } };
}

describe("PersonalIngestionKeyService", () => {
  describe("when a source a template names is installed", () => {
    it("mints a traces:create key on the caller's personal project and answers the token once", async () => {
      const { service, created, mint } = await setup([]);

      await expect(service.mint(mint)).resolves.toEqual({
        token: "ik-lw-0123456789ab",
        apiKeyId: "ak_new",
        prefix: "ik-lw-012345",
        sourceType: "cursor",
      });
      expect(created).toMatchObject([
        {
          userId: "user_1",
          permissions: ["traces:create"],
          bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_p" }],
          parentApiKeyId: null,
        },
      ]);
    });
  });

  describe("when the source is a tool the CLI wraps, or no template names it", () => {
    it("refuses a wrapped tool by code", async () => {
      const { service, mint } = await setup([]);

      await expect(service.mint({ ...mint, sourceType: "claude_code" })).rejects.toMatchObject({
        code: "ingestion_key_source_not_allowed",
      });
    });

    it("refuses a template whose source differs by code", async () => {
      const { service, mint } = await setup([]);

      await expect(service.mint({ ...mint, sourceType: "windsurf" })).rejects.toMatchObject({
        code: "ingestion_key_source_not_allowed",
      });
    });
  });

  describe("when a source is rotated", () => {
    it("revokes every live key of that source and template, then mints one", async () => {
      const { service, revoked, mint } = await setup([
        apiKey({ id: "ak_a", createdByDeviceLabel: "laptop" }),
        apiKey({ id: "ak_b", ingestionTemplateId: "other" }),
        apiKey({ id: "ak_c", ingestSourceType: "windsurf" }),
      ]);

      await expect(service.rotate(mint)).resolves.toMatchObject({
        apiKeyId: "ak_new",
        revokedCount: 1,
        revokedDeviceLabels: ["laptop"],
      });
      expect(revoked).toEqual(["ak_a"]);
    });
  });

  describe("when the caller revokes a key", () => {
    it("refuses another member's key as not found", async () => {
      const { service } = await setup([apiKey({ userId: "user_2" })]);

      await expect(
        service.revoke({ userId: "user_1", organizationId: "org_1", apiKeyId: "ak_1" }),
      ).rejects.toMatchObject({ code: "ingestion_key_not_found" });
    });

    it("succeeds when the key was already revoked underneath", async () => {
      const { service } = await setup([apiKey({})], async ({ id }) => {
        throw new ApiKeyAlreadyRevokedError(id);
      });

      await expect(
        service.revoke({ userId: "user_1", organizationId: "org_1", apiKeyId: "ak_1" }),
      ).resolves.toBeUndefined();
    });
  });
});
