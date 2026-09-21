// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The tile's rotate is revoke-every-key-for-this-source, then mint. The
 * revoke half kills every machine's key for one (source, template), says
 * which machines they were, and mints nothing when one survives.
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
  PersonalWorkspaceService: class {},
}));

import { ApiKeyAlreadyRevokedError } from "~/server/api-key/errors";

import { IngestionKeyRevokeIncompleteError } from "../ingestionKey.errors";
import { IngestionKeyService } from "../ingestionKey.service";

const PARAMS = {
  userId: "user_1",
  organizationId: "org_1",
  sourceType: "claude_cowork",
  ingestionTemplateId: "tmpl_cowork",
} as const;

const priorKey = ({
  id,
  sourceType = "claude_cowork",
  ingestionTemplateId = "tmpl_cowork",
  deviceLabel = id,
}: {
  id: string;
  sourceType?: string;
  ingestionTemplateId?: string | null;
  deviceLabel?: string | null;
}) => ({
  id,
  name: `Ingestion key (${sourceType})`,
  ingestSourceType: sourceType,
  ingestionTemplateId,
  createdByDeviceLabel: deviceLabel,
  roleBindings: [],
});

describe("IngestionKeyService.revokeForSource", () => {
  let service: IngestionKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = IngestionKeyService.create({} as never);
    templates.findByIdForOrg.mockResolvedValue({
      id: "tmpl_cowork",
      sourceType: "claude_cowork",
    });
  });

  describe("when several machines hold live keys for the same source", () => {
    /** @scenario "Rotating a template source from the tile revokes every key for it and says how many" */
    it("revokes all of them, names their machines, and touches no other source", async () => {
      apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
        priorKey({ id: "ak_laptop" }),
        priorKey({ id: "ak_desktop" }),
        priorKey({ id: "ak_vm", deviceLabel: null }),
        // Another source's key, which this rotation is not about.
        priorKey({
          id: "ak_other",
          sourceType: "other_tool",
          ingestionTemplateId: "tmpl_other",
        }),
        // The same source under a different template, likewise.
        priorKey({ id: "ak_no_tmpl", ingestionTemplateId: null }),
      ]);

      const result = await service.revokeForSource(PARAMS);

      expect(result).toEqual({
        revokedCount: 3,
        deviceLabels: [
          "ak_laptop",
          "ak_desktop",
          "Ingestion key (claude_cowork)",
        ],
      });
      expect(apiKeys.revoke.mock.calls.map(([args]) => args.id)).toEqual([
        "ak_laptop",
        "ak_desktop",
        "ak_vm",
      ]);
    });

    it("names the rotation as the cause and holds no projection", async () => {
      apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
        priorKey({ id: "ak_prior" }),
      ]);

      await service.revokeForSource(PARAMS);

      expect(apiKeys.revoke).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ak_prior",
          cause: "rotation",
          awaitProjection: false,
        }),
      );
    });
  });

  describe("when one of the prior keys cannot be revoked", () => {
    /** @scenario "A rotation that cannot kill every prior key mints nothing" */
    it("still tries the rest, then fails naming the survivors", async () => {
      apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
        priorKey({ id: "ak_laptop" }),
        priorKey({ id: "ak_desktop" }),
        priorKey({ id: "ak_vm" }),
      ]);
      apiKeys.revoke.mockImplementation(async ({ id }: { id: string }) => {
        if (id === "ak_desktop") throw new Error("postgres is down");
      });

      const failure = await service.revokeForSource(PARAMS).catch((e) => e);

      expect(failure).toBeInstanceOf(IngestionKeyRevokeIncompleteError);
      expect(failure.meta.survivors).toEqual(["ak_desktop"]);
      expect(apiKeys.revoke.mock.calls.map(([args]) => args.id)).toEqual([
        "ak_laptop",
        "ak_desktop",
        "ak_vm",
      ]);
    });
  });

  describe("when a prior key was revoked by someone else a moment earlier", () => {
    it("treats it as done rather than as a survivor", async () => {
      apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
        priorKey({ id: "ak_laptop" }),
        priorKey({ id: "ak_desktop" }),
      ]);
      apiKeys.revoke.mockImplementation(async ({ id }: { id: string }) => {
        if (id === "ak_laptop") throw new ApiKeyAlreadyRevokedError(id);
      });

      const result = await service.revokeForSource(PARAMS);

      expect(result.revokedCount).toBe(1);
      expect(result.deviceLabels).toEqual(["ak_desktop"]);
    });
  });

  describe("when the source is a tool the CLI wraps", () => {
    /** @scenario "The tile and the MCP mint refuse a tool the CLI wraps" */
    it("refuses before revoking anything, since the mint after it would be refused too", async () => {
      apiKeyRepo.findIngestKeysForUser.mockResolvedValue([
        priorKey({
          id: "ak_laptop",
          sourceType: "claude_code",
          ingestionTemplateId: null,
        }),
      ]);

      await expect(
        service.revokeForSource({
          ...PARAMS,
          sourceType: "claude_code",
          ingestionTemplateId: null,
        }),
      ).rejects.toMatchObject({ code: "ingestion_key_source_not_allowed" });

      expect(apiKeys.revoke).not.toHaveBeenCalled();
    });
  });

  describe("when no prior key exists", () => {
    it("revokes nothing and reports zero", async () => {
      apiKeyRepo.findIngestKeysForUser.mockResolvedValue([]);

      const result = await service.revokeForSource(PARAMS);

      expect(result).toEqual({ revokedCount: 0, deviceLabels: [] });
      expect(apiKeys.revoke).not.toHaveBeenCalled();
    });
  });
});
