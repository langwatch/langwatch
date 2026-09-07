// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A personal ingest key belongs to the CLI session that minted it: the mint
 * parents it to the session's login key and refuses a session that is
 * signed out, a mint with no session accepts only template sources, and a
 * session cascade retires exactly the keys under one login key.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiKeys = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
}));
const apiKeyRepo = vi.hoisted(() => ({
  findIngestKeysForUser: vi.fn(),
  findByIdInOrg: vi.fn(),
  findByLookupId: vi.fn(),
}));
const workspace = vi.hoisted(() => ({
  findExisting: vi.fn(),
}));
const templates = vi.hoisted(() => ({
  findByIdForOrg: vi.fn(),
}));

vi.mock("~/server/api-key/api-key.service", () => ({
  ApiKeyService: { create: () => apiKeys },
}));
vi.mock("~/server/api-key/api-key.repository", () => ({
  ApiKeyRepository: { create: () => apiKeyRepo },
}));
vi.mock("../../repositories/ingestionTemplate.repository", () => ({
  IngestionTemplateRepository: class {
    findByIdForOrg = templates.findByIdForOrg;
  },
}));
vi.mock("../personalWorkspace.service", () => ({
  PersonalWorkspaceService: class {
    findExisting = workspace.findExisting;
  },
}));

import { ApiKeyAlreadyRevokedError } from "~/server/api-key/errors";

import {
  IngestionKeyNotFoundError,
  IngestionKeySessionRevokedError,
  IngestionKeySourceNotAllowedError,
} from "../ingestionKey.errors";
import { IngestionKeyService } from "../ingestionKey.service";

const USER = "user_1";
const ORG = "org_1";
const LOGIN_KEY = "ak_login";

function loginKey({ revoked = false }: { revoked?: boolean } = {}) {
  return {
    id: LOGIN_KEY,
    organizationId: ORG,
    userId: USER,
    revokedAt: revoked ? new Date() : null,
    ingestSourceType: null,
    roleBindings: [],
  };
}

function ingestKey({
  id,
  parentApiKeyId = LOGIN_KEY,
  sourceType = "claude_code",
  revokedAt = null,
  deviceLabel = "laptop",
}: {
  id: string;
  parentApiKeyId?: string | null;
  sourceType?: string;
  revokedAt?: Date | null;
  deviceLabel?: string | null;
}) {
  return {
    id,
    name: `Ingestion key (${sourceType}, ${deviceLabel})`,
    organizationId: ORG,
    userId: USER,
    lookupId: `lookup_${id}`,
    parentApiKeyId,
    ingestSourceType: sourceType,
    ingestionTemplateId: null,
    createdByDeviceLabel: deviceLabel,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    lastUsedAt: null,
    revokedAt,
    revocationCause: null,
    roleBindings: [],
  };
}

describe("IngestionKeyService", () => {
  let service: IngestionKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = IngestionKeyService.create({} as never);
    templates.findByIdForOrg.mockResolvedValue(null);
    workspace.findExisting.mockResolvedValue({ project: { id: "project_1" } });
    apiKeyRepo.findByIdInOrg.mockResolvedValue(loginKey());
    apiKeyRepo.findIngestKeysForUser.mockResolvedValue([]);
    apiKeys.create.mockResolvedValue({
      token: "ik-lw-fresh-token",
      apiKey: { id: "ak_new" },
    });
  });

  describe("when a personal ingestion key is minted", () => {
    describe("given a CLI session whose login key is live", () => {
      /** @scenario "A key minted by a CLI session is parented to that session's login key" */
      it("parents the key to the login key and stamps the session's label", async () => {
        const issued = await service.mint({
          userId: USER,
          organizationId: ORG,
          sourceType: "claude_code",
          parentApiKeyId: LOGIN_KEY,
          createdByDeviceLabel: "laptop",
        });

        expect(issued.apiKeyId).toBe("ak_new");
        expect(apiKeys.create).toHaveBeenCalledWith(
          expect.objectContaining({
            parentApiKeyId: LOGIN_KEY,
            createdByDeviceLabel: "laptop",
            ingestSourceType: "claude_code",
            userId: USER,
          }),
        );
        expect(apiKeys.revoke).not.toHaveBeenCalled();
      });

      /** @scenario "A personal key is minted only for a tool the CLI wraps" */
      it("refuses a source type no wrapped tool stamps before it looks at anything", async () => {
        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "made_up",
            parentApiKeyId: LOGIN_KEY,
          }),
        ).rejects.toMatchObject({ code: "ingestion_key_source_not_allowed" });

        expect(workspace.findExisting).not.toHaveBeenCalled();
        expect(apiKeys.create).not.toHaveBeenCalled();
      });
    });

    describe("given a login key revoked while the mint was in flight", () => {
      /** @scenario "A key minted as its session is being retired does not outlive it" */
      it("retires the key it just wrote and answers signed out", async () => {
        // Live when the mint checks, revoked by the time the row exists: the
        // cascade revoked the parent and listed its children in between.
        apiKeyRepo.findByIdInOrg
          .mockResolvedValueOnce(loginKey())
          .mockResolvedValueOnce(loginKey({ revoked: true }));

        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "claude_code",
            parentApiKeyId: LOGIN_KEY,
          }),
        ).rejects.toBeInstanceOf(IngestionKeySessionRevokedError);

        expect(apiKeys.create).toHaveBeenCalledTimes(1);
        expect(apiKeys.revoke).toHaveBeenCalledWith(
          expect.objectContaining({ id: "ak_new", cause: "session" }),
        );
      });

      it("leaves a key alone when the session is still live after the write", async () => {
        const issued = await service.mint({
          userId: USER,
          organizationId: ORG,
          sourceType: "claude_code",
          parentApiKeyId: LOGIN_KEY,
        });

        expect(issued.apiKeyId).toBe("ak_new");
        expect(apiKeys.revoke).not.toHaveBeenCalled();
      });
    });

    describe("given a CLI session whose login key was revoked", () => {
      /** @scenario "A mint from a session whose login key is revoked is refused as signed out" */
      it("refuses as signed out and mints nothing", async () => {
        apiKeyRepo.findByIdInOrg.mockResolvedValue(loginKey({ revoked: true }));

        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "claude_code",
            parentApiKeyId: LOGIN_KEY,
          }),
        ).rejects.toBeInstanceOf(IngestionKeySessionRevokedError);

        expect(apiKeys.create).not.toHaveBeenCalled();
      });

      it("reads another person's login key as signed out too", async () => {
        apiKeyRepo.findByIdInOrg.mockResolvedValue({
          ...loginKey(),
          userId: "someone_else",
        });

        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "claude_code",
            parentApiKeyId: LOGIN_KEY,
          }),
        ).rejects.toBeInstanceOf(IngestionKeySessionRevokedError);
      });
    });

    describe("given a mint with no session behind it", () => {
      /** @scenario "A mint outside a CLI session accepts only a template-named source" */
      it("mints a source a published template names, with no parent", async () => {
        templates.findByIdForOrg.mockResolvedValue({
          id: "tmpl_cowork",
          sourceType: "claude_cowork",
        });

        const issued = await service.mint({
          userId: USER,
          organizationId: ORG,
          sourceType: "claude_cowork",
          ingestionTemplateId: "tmpl_cowork",
        });

        expect(issued.apiKeyId).toBe("ak_new");
        expect(apiKeys.create).toHaveBeenCalledWith(
          expect.objectContaining({
            parentApiKeyId: null,
            ingestionTemplateId: "tmpl_cowork",
          }),
        );
        expect(apiKeyRepo.findByIdInOrg).not.toHaveBeenCalled();
      });

      /** @scenario "A mint outside a CLI session accepts only a template-named source" */
      it("refuses a source type no template names", async () => {
        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "made_up",
            ingestionTemplateId: "tmpl_other",
          }),
        ).rejects.toBeInstanceOf(IngestionKeySourceNotAllowedError);
        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "made_up",
          }),
        ).rejects.toBeInstanceOf(IngestionKeySourceNotAllowedError);

        expect(apiKeys.create).not.toHaveBeenCalled();
      });

      /** @scenario "The tile and the MCP mint refuse a tool the CLI wraps" */
      it("refuses a tool the CLI wraps even when a template names it", async () => {
        templates.findByIdForOrg.mockResolvedValue({
          id: "tmpl_claude",
          sourceType: "claude_code",
        });

        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "claude_code",
            ingestionTemplateId: "tmpl_claude",
          }),
        ).rejects.toMatchObject({ code: "ingestion_key_source_not_allowed" });

        expect(apiKeys.create).not.toHaveBeenCalled();
      });
    });

    describe("given a caller with no personal workspace", () => {
      it("refuses before minting anything", async () => {
        workspace.findExisting.mockResolvedValue(null);

        await expect(
          service.mint({
            userId: USER,
            organizationId: ORG,
            sourceType: "claude_code",
            parentApiKeyId: LOGIN_KEY,
          }),
        ).rejects.toMatchObject({ code: "ingestion_key_workspace_missing" });
        expect(apiKeys.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("when a login key's session is retired", () => {
    describe("given keys under two sessions", () => {
      /** @scenario "A re-login from the same device retires the keys of the session it replaces" */
      it("revokes the keys under the named login key with the cause given, and no other", async () => {
        apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
          ingestKey({ id: "ak_laptop_claude" }),
          ingestKey({ id: "ak_laptop_codex", sourceType: "codex" }),
          ingestKey({ id: "ak_desktop", parentApiKeyId: "ak_other_login" }),
          ingestKey({ id: "ak_tile", parentApiKeyId: null }),
        ]);

        const result = await service.revokeForSession({
          parentApiKeyId: LOGIN_KEY,
          userId: USER,
          organizationId: ORG,
          cause: "session",
        });

        expect(result).toEqual({ revokedCount: 2 });
        expect(apiKeys.revoke.mock.calls.map(([args]) => args.id)).toEqual([
          "ak_laptop_claude",
          "ak_laptop_codex",
        ]);
        expect(apiKeys.revoke).toHaveBeenCalledWith(
          expect.objectContaining({ cause: "session", awaitProjection: false }),
        );
      });

      it("passes expired through as the cause of a session that ran out", async () => {
        apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
          ingestKey({ id: "ak_laptop_claude" }),
        ]);

        await service.revokeForSession({
          parentApiKeyId: LOGIN_KEY,
          userId: USER,
          organizationId: ORG,
          cause: "expired",
        });

        expect(apiKeys.revoke).toHaveBeenCalledWith(
          expect.objectContaining({ id: "ak_laptop_claude", cause: "expired" }),
        );
      });
    });

    describe("given a child someone revoked a moment earlier", () => {
      it("counts it as done and keeps going", async () => {
        apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
          ingestKey({ id: "ak_a" }),
          ingestKey({ id: "ak_b" }),
        ]);
        apiKeys.revoke.mockImplementation(async ({ id }: { id: string }) => {
          if (id === "ak_a") throw new ApiKeyAlreadyRevokedError(id);
        });

        const result = await service.revokeForSession({
          parentApiKeyId: LOGIN_KEY,
          userId: USER,
          organizationId: ORG,
          cause: "session",
        });

        expect(result).toEqual({ revokedCount: 1 });
        expect(apiKeys.revoke).toHaveBeenCalledTimes(2);
      });
    });

    describe("given a child that cannot be revoked", () => {
      it("still attempts the rest, then reports the failure", async () => {
        apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
          ingestKey({ id: "ak_a" }),
          ingestKey({ id: "ak_b" }),
        ]);
        apiKeys.revoke.mockImplementation(async ({ id }: { id: string }) => {
          if (id === "ak_a") throw new Error("postgres is down");
        });

        await expect(
          service.revokeForSession({
            parentApiKeyId: LOGIN_KEY,
            userId: USER,
            organizationId: ORG,
            cause: "session",
          }),
        ).rejects.toThrow(/could not be revoked/);
        expect(apiKeys.revoke.mock.calls.map(([args]) => args.id)).toEqual([
          "ak_a",
          "ak_b",
        ]);
      });
    });
  });

  describe("when the caller revokes one key", () => {
    describe("given one of the caller's own live keys", () => {
      it("revokes it as the person's decision", async () => {
        apiKeyRepo.findByIdInOrg.mockResolvedValue(
          ingestKey({ id: "ak_mine" }),
        );

        await service.revoke({
          userId: USER,
          organizationId: ORG,
          apiKeyId: "ak_mine",
        });

        expect(apiKeys.revoke).toHaveBeenCalledWith(
          expect.objectContaining({ id: "ak_mine", cause: "user" }),
        );
      });
    });

    describe("given a key already revoked", () => {
      it("leaves it as it is and does not fail", async () => {
        apiKeyRepo.findByIdInOrg.mockResolvedValue(
          ingestKey({ id: "ak_dead", revokedAt: new Date() }),
        );

        await service.revoke({
          userId: USER,
          organizationId: ORG,
          apiKeyId: "ak_dead",
        });

        expect(apiKeys.revoke).not.toHaveBeenCalled();
      });
    });

    describe("given another person's key, or a key that is not an ingestion key", () => {
      it("answers not found without confirming the key exists", async () => {
        apiKeyRepo.findByIdInOrg.mockResolvedValue({
          ...ingestKey({ id: "ak_theirs" }),
          userId: "someone_else",
        });
        await expect(
          service.revoke({
            userId: USER,
            organizationId: ORG,
            apiKeyId: "ak_theirs",
          }),
        ).rejects.toBeInstanceOf(IngestionKeyNotFoundError);

        apiKeyRepo.findByIdInOrg.mockResolvedValue(loginKey());
        await expect(
          service.revoke({
            userId: USER,
            organizationId: ORG,
            apiKeyId: LOGIN_KEY,
          }),
        ).rejects.toBeInstanceOf(IngestionKeyNotFoundError);

        expect(apiKeys.revoke).not.toHaveBeenCalled();
      });
    });
  });

  describe("when the caller lists their keys", () => {
    describe("given a session-parented key and a tile key", () => {
      it("reports each key with the session it belongs to", async () => {
        apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
          ingestKey({ id: "ak_laptop" }),
          ingestKey({ id: "ak_tile", parentApiKeyId: null, deviceLabel: null }),
        ]);

        const rows = await service.list({ userId: USER, organizationId: ORG });

        expect(rows).toEqual([
          expect.objectContaining({
            apiKeyId: "ak_laptop",
            parentApiKeyId: LOGIN_KEY,
            deviceLabel: "laptop",
            sourceType: "claude_code",
            lookupId: "lookup_ak_laptop",
            lastUsedAtMs: null,
          }),
          expect.objectContaining({
            apiKeyId: "ak_tile",
            parentApiKeyId: null,
            deviceLabel: null,
          }),
        ]);
      });
    });
  });
});
