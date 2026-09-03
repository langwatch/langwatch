// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The personal-workspace mint is create-only per device and capped: it never
 * revokes the key another device is exporting with, and past the cap it
 * revokes the key that has gone unused the longest.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiKeys = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
}));
const apiKeyRepo = vi.hoisted(() => ({
  findIngestKey: vi.fn(),
  findIngestKeysForProject: vi.fn(),
}));
const workspace = vi.hoisted(() => ({
  findExisting: vi.fn(),
}));

vi.mock("~/server/api-key/api-key.service", () => ({
  ApiKeyService: { create: () => apiKeys },
}));
vi.mock("~/server/api-key/api-key.repository", () => ({
  ApiKeyRepository: { create: () => apiKeyRepo },
}));
vi.mock("../personalWorkspace.service", () => ({
  PersonalWorkspaceService: class {
    findExisting = workspace.findExisting;
  },
}));

import {
  IngestionKeyService,
  PERSONAL_INGEST_KEYS_PER_TOOL_CAP,
} from "../ingestionKey.service";

const PARAMS = {
  userId: "user_1",
  organizationId: "org_1",
  sourceType: "claude_code",
} as const;

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

function liveKey({
  id,
  sourceType = "claude_code",
  createdAt,
  lastUsedAt = null,
}: {
  id: string;
  sourceType?: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
}) {
  return {
    id,
    ingestSourceType: sourceType,
    ingestionTemplateId: null,
    createdAt,
    lastUsedAt,
    roleBindings: [],
  };
}

describe("IngestionKeyService.issueForPersonalProject", () => {
  let service: IngestionKeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = IngestionKeyService.create({} as never);
    workspace.findExisting.mockResolvedValue({ project: { id: "project_1" } });
    apiKeys.create.mockResolvedValue({
      token: "ik-lw-fresh-token",
      apiKey: { id: "ak_new" },
    });
  });

  describe("when other devices already hold live keys under the cap", () => {
    it("mints a new key and revokes none of them", async () => {
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([
        liveKey({ id: "ak_new", createdAt: day(9) }),
        liveKey({ id: "ak_laptop", createdAt: day(1) }),
        liveKey({ id: "ak_desktop", createdAt: day(2) }),
      ]);

      const issued = await service.issueForPersonalProject(PARAMS);

      expect(issued.apiKeyId).toBe("ak_new");
      expect(apiKeys.revoke).not.toHaveBeenCalled();
      expect(apiKeyRepo.findIngestKey).not.toHaveBeenCalled();
    });
  });

  describe("when the workspace already holds the cap of live keys for the tool", () => {
    it("revokes the key unused the longest, and only that one", async () => {
      const others = Array.from(
        { length: PERSONAL_INGEST_KEYS_PER_TOOL_CAP },
        (_, i) =>
          liveKey({
            id: `ak_${i}`,
            createdAt: day(i),
            // Every key exported recently except ak_3, idle since its mint.
            lastUsedAt: i === 3 ? null : day(20 + i),
          }),
      );
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([
        liveKey({ id: "ak_new", createdAt: day(30) }),
        ...others,
      ]);

      await service.issueForPersonalProject(PARAMS);

      expect(apiKeys.revoke).toHaveBeenCalledTimes(1);
      expect(apiKeys.revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_3", awaitProjection: false }),
      );
    });

    it("never revokes the key it just minted", async () => {
      const others = Array.from(
        { length: PERSONAL_INGEST_KEYS_PER_TOOL_CAP },
        (_, i) => liveKey({ id: `ak_${i}`, createdAt: day(i + 1) }),
      );
      // The fresh key sorts oldest by creation on purpose; it must survive.
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([
        liveKey({ id: "ak_new", createdAt: day(0) }),
        ...others,
      ]);

      await service.issueForPersonalProject(PARAMS);

      const revoked = apiKeys.revoke.mock.calls.map(
        (call) => (call[0] as { id: string }).id,
      );
      expect(revoked).not.toContain("ak_new");
      expect(revoked).toEqual(["ak_0"]);
    });

    it("counts one tool at a time", async () => {
      const claudeKeys = Array.from(
        { length: PERSONAL_INGEST_KEYS_PER_TOOL_CAP },
        (_, i) => liveKey({ id: `ak_claude_${i}`, createdAt: day(i) }),
      );
      apiKeyRepo.findIngestKeysForProject.mockResolvedValue([
        liveKey({ id: "ak_new", sourceType: "codex", createdAt: day(30) }),
        ...claudeKeys,
      ]);

      await service.issueForPersonalProject({ ...PARAMS, sourceType: "codex" });

      expect(apiKeys.revoke).not.toHaveBeenCalled();
    });
  });

  describe("when the caller has no personal workspace", () => {
    it("refuses before minting anything", async () => {
      workspace.findExisting.mockResolvedValue(null);

      await expect(service.issueForPersonalProject(PARAMS)).rejects.toThrow();
      expect(apiKeys.create).not.toHaveBeenCalled();
    });
  });
});
