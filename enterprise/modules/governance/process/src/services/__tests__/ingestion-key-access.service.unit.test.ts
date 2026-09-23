// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import {
  ApiKeyIngestionKeyIssuerService,
  ApiKeyIngestionKeyRepositoryService,
} from "../ingestion-key-access.service.ts";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/** Complete API-key boundary for tests that only exercise a few methods. */
class FakeApiKeyApi implements ApiKeyApi {
  assertSelectionWithinCeiling = unsupported<ApiKeyApi["assertSelectionWithinCeiling"]>();
  create = unsupported<ApiKeyApi["create"]>();
  createKey = unsupported<ApiKeyApi["createKey"]>();
  credentialCanManageOrganization = unsupported<ApiKeyApi["credentialCanManageOrganization"]>();
  enrichApiKeyList = unsupported<ApiKeyApi["enrichApiKeyList"]>();
  enrichBindingsWithNames = unsupported<ApiKeyApi["enrichBindingsWithNames"]>();
  ensureCallerIsOrgMember = unsupported<ApiKeyApi["ensureCallerIsOrgMember"]>();
  extendCliLoginKeyExpiry = unsupported<ApiKeyApi["extendCliLoginKeyExpiry"]>();
  findById = unsupported<ApiKeyApi["findById"]>();
  findByLookupId = unsupported<ApiKeyApi["findByLookupId"]>();
  findDefaultCliSelection = unsupported<ApiKeyApi["findDefaultCliSelection"]>();
  findIngestionKey = unsupported<ApiKeyApi["findIngestionKey"]>();
  findKeyName = unsupported<ApiKeyApi["findKeyName"]>();
  findNameByIdInOrg = unsupported<ApiKeyApi["findNameByIdInOrg"]>();
  findResolvedToken = unsupported<ApiKeyApi["findResolvedToken"]>();
  findVerifiedToken = unsupported<ApiKeyApi["findVerifiedToken"]>();
  getByIdForCaller = unsupported<ApiKeyApi["getByIdForCaller"]>();
  getOrgMembers = unsupported<ApiKeyApi["getOrgMembers"]>();
  getOrgProjects = unsupported<ApiKeyApi["getOrgProjects"]>();
  getOrgTeams = unsupported<ApiKeyApi["getOrgTeams"]>();
  getUserBindings = unsupported<ApiKeyApi["getUserBindings"]>();
  isOrgAdmin = unsupported<ApiKeyApi["isOrgAdmin"]>();
  isOrgAdminApiKey = unsupported<ApiKeyApi["isOrgAdminApiKey"]>();
  list = unsupported<ApiKeyApi["list"]>();
  listAll = unsupported<ApiKeyApi["listAll"]>();
  listForCaller = unsupported<ApiKeyApi["listForCaller"]>();
  listCallerBindings = unsupported<ApiKeyApi["listCallerBindings"]>();
  listIngestionKeysForProject = unsupported<ApiKeyApi["listIngestionKeysForProject"]>();
  listKeys = unsupported<ApiKeyApi["listKeys"]>();
  listOrganizationMembers = unsupported<ApiKeyApi["listOrganizationMembers"]>();
  listOrganizationProjects = unsupported<ApiKeyApi["listOrganizationProjects"]>();
  listOrganizationTeams = unsupported<ApiKeyApi["listOrganizationTeams"]>();
  markUsed = unsupported<ApiKeyApi["markUsed"]>();
  mintCliLoginKey = unsupported<ApiKeyApi["mintCliLoginKey"]>();
  regenerateLegacyProjectKey = unsupported<ApiKeyApi["regenerateLegacyProjectKey"]>();
  resolveOrganizationToken = unsupported<ApiKeyApi["resolveOrganizationToken"]>();
  resolveVisibleProjects = unsupported<ApiKeyApi["resolveVisibleProjects"]>();
  revoke = unsupported<ApiKeyApi["revoke"]>();
  revokeCliLoginKeyForLogout = unsupported<ApiKeyApi["revokeCliLoginKeyForLogout"]>();
  revokeCliLoginKeysForDevice = unsupported<ApiKeyApi["revokeCliLoginKeysForDevice"]>();
  revokeKey = unsupported<ApiKeyApi["revokeKey"]>();
  update = unsupported<ApiKeyApi["update"]>();
  updateAsCaller = unsupported<ApiKeyApi["updateAsCaller"]>();
  updateKey = unsupported<ApiKeyApi["updateKey"]>();
  validateCliSelection = unsupported<ApiKeyApi["validateCliSelection"]>();
}

function apiKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ak_1",
    lookupId: "lookup_1",
    organizationId: "org_1",
    userId: "user_1",
    ingestSourceType: "claude_code",
    ingestionTemplateId: null,
    lastUsedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    revokedAt: null,
    revocationCause: null,
    ...overrides,
  };
}

describe("ApiKeyIngestionKeyRepositoryService", () => {
  describe("when an ingest key exists for the project and source", () => {
    it("asks ApiKeyApi and maps the row onto a stored ingestion key", async () => {
      const apiKeys = new FakeApiKeyApi();
      apiKeys.findIngestionKey = vi.fn().mockResolvedValue(apiKeyRow());
      const repository = ApiKeyIngestionKeyRepositoryService.create(apiKeys);

      const result = await repository.findIngestKey({
        organizationId: "org_1",
        projectId: "project_1",
        sourceType: "claude_code",
      });

      expect(apiKeys.findIngestionKey).toHaveBeenCalledWith({
        organizationId: "org_1",
        projectId: "project_1",
        sourceType: "claude_code",
      });
      expect(result).toMatchObject({ id: "ak_1", lookupId: "lookup_1" });
    });
  });

  describe("when no ingest key exists", () => {
    it("answers null rather than throwing", async () => {
      const apiKeys = new FakeApiKeyApi();
      apiKeys.findIngestionKey = vi.fn().mockResolvedValue(null);
      const repository = ApiKeyIngestionKeyRepositoryService.create(apiKeys);

      const result = await repository.findIngestKey({
        organizationId: "org_1",
        projectId: "project_1",
        sourceType: "claude_code",
      });

      expect(result).toBeNull();
    });
  });

  describe("when listing ingest keys for a project", () => {
    it("maps every row the peer answers", async () => {
      const apiKeys = new FakeApiKeyApi();
      apiKeys.listIngestionKeysForProject = vi
        .fn()
        .mockResolvedValue([apiKeyRow({ id: "ak_1" }), apiKeyRow({ id: "ak_2" })]);
      const repository = ApiKeyIngestionKeyRepositoryService.create(apiKeys);

      const result = await repository.findIngestKeysForProject({
        organizationId: "org_1",
        projectId: "project_1",
      });

      expect(result.map((key) => key.id)).toEqual(["ak_1", "ak_2"]);
    });
  });

  describe("when a key is looked up by its lookup id", () => {
    it("carries ownership and revocation state onto the answer", async () => {
      const apiKeys = new FakeApiKeyApi();
      apiKeys.findByLookupId = vi
        .fn()
        .mockResolvedValue(
          apiKeyRow({ revokedAt: new Date("2026-02-01T00:00:00.000Z"), revocationCause: "cap" }),
        );
      const repository = ApiKeyIngestionKeyRepositoryService.create(apiKeys);

      const result = await repository.findByLookupId({ lookupId: "lookup_1" });

      expect(result).toMatchObject({
        organizationId: "org_1",
        userId: "user_1",
        revocationCause: "cap",
      });
    });

    it("answers null when the peer finds no such key", async () => {
      const apiKeys = new FakeApiKeyApi();
      apiKeys.findByLookupId = vi.fn().mockResolvedValue(null);
      const repository = ApiKeyIngestionKeyRepositoryService.create(apiKeys);

      const result = await repository.findByLookupId({ lookupId: "missing" });

      expect(result).toBeNull();
    });
  });
});

describe("ApiKeyIngestionKeyIssuerService", () => {
  describe("when a key is minted", () => {
    it("creates it through ApiKeyApi and answers the token and id", async () => {
      const apiKeys = new FakeApiKeyApi();
      apiKeys.create = vi.fn().mockResolvedValue({
        token: "ik-lw-token",
        apiKey: { id: "ak_new" },
      });
      const issuer = ApiKeyIngestionKeyIssuerService.create(apiKeys);

      const result = await issuer.create({
        name: "Ingestion key",
        userId: "user_1",
        createdByUserId: "user_1",
        organizationId: "org_1",
        permissionMode: "restricted",
        permissions: ["traces:create"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_1" }],
        ingestSourceType: "claude_code",
        ingestionTemplateId: null,
        createdByDeviceLabel: null,
      });

      expect(apiKeys.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Ingestion key", ingestSourceType: "claude_code" }),
      );
      expect(result).toEqual({ token: "ik-lw-token", apiKey: { id: "ak_new" } });
    });
  });

  describe("when a key is revoked", () => {
    it("revokes it through ApiKeyApi and answers nothing", async () => {
      const apiKeys = new FakeApiKeyApi();
      apiKeys.revoke = vi.fn().mockResolvedValue(apiKeyRow({ revokedAt: new Date() }));
      const issuer = ApiKeyIngestionKeyIssuerService.create(apiKeys);

      const result = await issuer.revoke({
        id: "ak_1",
        callerUserId: "user_1",
        callerIsAdmin: true,
        organizationId: "org_1",
        awaitProjection: false,
        cause: "rotation",
      });

      expect(apiKeys.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_1", cause: "rotation" }),
      );
      expect(result).toBeUndefined();
    });
  });
});
