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
  findIngestKey: vi.fn(),
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
    /** @scenario "A hard-cut rotation holds once, on the new key's grants" */
    it("revokes it without a projection hold of its own", async () => {
      apiKeyRepo.findIngestKey.mockResolvedValue({ id: "ak_prior" });

      await service.ensureForProject(MINT_PARAMS);

      expect(apiKeys.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_prior", awaitProjection: false }),
      );
      // The mint that follows is the chain's one awaited write.
      expect(apiKeys.revoke).toHaveBeenCalledBefore(apiKeys.create);
      expect(apiKeys.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no prior key exists", () => {
    it("mints without revoking anything", async () => {
      apiKeyRepo.findIngestKey.mockResolvedValue(null);

      const issued = await service.ensureForProject(MINT_PARAMS);

      expect(apiKeys.revoke).not.toHaveBeenCalled();
      expect(issued.apiKeyId).toBe("ak_new");
    });
  });
});
