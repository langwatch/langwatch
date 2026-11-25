/**
 * The ingestion-key mint: a person's own key on their session's project, refused for any other
 * caller first and any other shape second, with the same two errors the route always raised.
 */
import { ApiKeyScopeViolationError, type ApiKeyApi } from "@langwatch/api-key-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { IngestionKeyMintService } from "../ingestion-key-mint.service.ts";

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";

const INGESTION_SHAPE = {
  name: "laptop / my-project",
  keyType: "personal",
  permissionMode: "restricted",
  permissions: ["traces:create"],
  bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID }],
} as const;

function createService() {
  const create = vi.fn();
  create.mockResolvedValue({ token: "sk-lw-ingestion", apiKey: { id: "ingestion-key" } });
  const service = IngestionKeyMintService.create({
    apiKeys: createApiFixture<ApiKeyApi>({ create }),
  });

  return { service, create };
}

describe("IngestionKeyMintService", () => {
  describe("when a person's session asks for the ingestion shape", () => {
    it("mints their own restricted key bound to the session's project", async () => {
      const { service, create } = createService();

      const result = await service.createIngestionKey({
        key: {
          ...INGESTION_SHAPE,
          bindings: [...INGESTION_SHAPE.bindings],
          permissions: ["traces:create"],
        },
        principal: { type: "user", id: USER_ID },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      });

      expect(result.token).toBe("sk-lw-ingestion");
      expect(create).toHaveBeenCalledWith({
        name: INGESTION_SHAPE.name,
        description: undefined,
        userId: USER_ID,
        createdByUserId: USER_ID,
        organizationId: ORGANIZATION_ID,
        expiresAt: undefined,
        permissionMode: "restricted",
        permissions: ["traces:create"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: PROJECT_ID }],
      });
    });
  });

  describe("when the caller is an API key", () => {
    it("refuses as not a person before it looks at the shape", async () => {
      const { service, create } = createService();

      const minting = service.createIngestionKey({
        key: { name: "wrong", keyType: "service", permissionMode: "all" },
        principal: { type: "apiKey", id: "key-1" },
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      });

      await expect(minting).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      await expect(minting).rejects.toMatchObject({
        code: "api_key_scope_violation",
        message: "Only a person's sign-in session mints an ingestion key",
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when there is no principal", () => {
    it("refuses as not a person", async () => {
      const { service } = createService();

      await expect(
        service.createIngestionKey({
          key: {
            ...INGESTION_SHAPE,
            bindings: [...INGESTION_SHAPE.bindings],
            permissions: ["traces:create"],
          },
          principal: null,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({
        message: "Only a person's sign-in session mints an ingestion key",
      });
    });
  });

  describe("when a person asks for any other shape", () => {
    it("refuses the shape and mints nothing", async () => {
      const { service, create } = createService();

      await expect(
        service.createIngestionKey({
          key: {
            ...INGESTION_SHAPE,
            bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "another-project" }],
            permissions: ["traces:create"],
          },
          principal: { type: "user", id: USER_ID },
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({
        code: "api_key_scope_violation",
        message:
          "An ingestion key is personal, bound to this one project, and holds only ingestion",
      });
      expect(create).not.toHaveBeenCalled();
    });
  });
});
