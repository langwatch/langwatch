// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hard-cut rotation's latency contract: one request, one projection
 * hold. The revoke of the prior key rides the same per-organization FIFO
 * ledger queue as the mint that follows, so only the mint's final grant
 * attach needs to hold for the projection.
 *
 * Feature: specs/api-keys/ingest-key-rotation-latency.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiKeys = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
}));
const apiKeyRepo = vi.hoisted(() => ({
  findIngestKeysForProject: vi.fn(),
}));

vi.mock("~/server/api-key/api-key.service", () => ({
  ApiKeyService: { create: () => apiKeys },
}));
vi.mock("~/server/api-key/api-key.repository", () => ({
  ApiKeyRepository: { create: () => apiKeyRepo },
}));
vi.mock("../personalWorkspace.service", () => ({
  PersonalWorkspaceService: class {},
}));

import { IngestionKeyService } from "../ingestionKey.service";

const MINT_PARAMS = {
  callerUserId: "user_1",
  ownerUserId: "user_1",
  organizationId: "org_1",
  projectId: "project_1",
  sourceType: "claude_code",
} as const;

const priorKey = (id: string, sourceType = "claude_code") => ({
  id,
  ingestSourceType: sourceType,
  ingestionTemplateId: null,
});

describe("IngestionKeyService.ensureForProject", () => {
  let service: IngestionKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = IngestionKeyService.create({} as never);
    apiKeys.create.mockResolvedValue({
      token: "ik-lw-fake-token",
      apiKey: { id: "ak_new" },
    });
  });

  describe("when a prior key exists for the project and source type", () => {
    /** @scenario "Rotating a key answers without waiting on the old key's cleanup" */
    it("revokes it without a projection hold of its own", async () => {
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([
        priorKey("ak_prior"),
      ]);

      await service.ensureForProject(MINT_PARAMS);

      expect(apiKeys.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_prior", awaitProjection: false }),
      );
      // The mint that follows is the chain's one awaited write.
      expect(apiKeys.revoke).toHaveBeenCalledBefore(apiKeys.create);
      expect(apiKeys.create).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A hard-cut rotation names itself as the cause" */
    it("names the rotation as the cause of the revoke", async () => {
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([
        priorKey("ak_prior"),
      ]);

      await service.ensureForProject(MINT_PARAMS);

      expect(apiKeys.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_prior", cause: "rotation" }),
      );
    });
  });

  describe("when several machines hold live keys for the same tool", () => {
    /** @scenario "An explicit rotation from the personal tile revokes every prior key" */
    it("revokes all of them, not just the first", async () => {
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([
        priorKey("ak_laptop"),
        priorKey("ak_desktop"),
        priorKey("ak_vm"),
        // Another tool's key, which this rotation is not about.
        priorKey("ak_codex", "codex"),
      ]);

      await service.ensureForProject(MINT_PARAMS);

      expect(apiKeys.revoke.mock.calls.map(([args]) => args.id)).toEqual([
        "ak_laptop",
        "ak_desktop",
        "ak_vm",
      ]);
    });
  });

  describe("when no prior key exists", () => {
    it("mints without revoking anything", async () => {
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([]);

      const issued = await service.ensureForProject(MINT_PARAMS);

      expect(apiKeys.revoke).not.toHaveBeenCalled();
      expect(issued.apiKeyId).toBe("ak_new");
    });
  });
});
