/**
 * A key's grants are read off authz's grants head, never the retired
 * RoleBinding table (#7633). specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzAccessBinding, AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRow } from "../../repositories/api-key.repository.ts";
import { ApiKeyBindingsService } from "../api-key-bindings.service.ts";

function row(id: string, organizationId = "org-1"): ApiKeyRow {
  const at = new Date("2026-09-01T00:00:00Z");
  return {
    id,
    name: id,
    description: null,
    organizationId,
    userId: null,
    createdByUserId: null,
    createdByDeviceLabel: null,
    parentApiKeyId: null,
    lookupId: `lookup-${id}`,
    hashedSecret: "hashed",
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    revocationCause: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: at,
    updatedAt: at,
  };
}

function grant(apiKeyId: string, over: Partial<AuthzAccessBinding> = {}): AuthzAccessBinding {
  return {
    id: `grant-${apiKeyId}`,
    organizationId: "org-1",
    userId: null,
    groupId: null,
    apiKeyId,
    role: "VIEWER",
    customRoleId: null,
    scopeType: "PROJECT",
    scopeId: "project-1",
    createdAt: new Date(0),
    user: null,
    group: null,
    apiKey: null,
    customRole: null,
    ...over,
  };
}

describe("joining a key's grants", () => {
  describe("given keys from two organizations", () => {
    it("reads each organization's grants once and attaches them to their own key", async () => {
      const listApiKeyBindings = vi.fn(async ({ organizationId }: { organizationId: string }) =>
        organizationId === "org-1"
          ? [grant("key-1")]
          : [
              grant("key-2", {
                organizationId: "org-2",
                scopeType: "ORGANIZATION",
                scopeId: "org-2",
              }),
            ],
      );
      const bindings = ApiKeyBindingsService.create({
        authz: createApiFixture<AuthzApi>({ listApiKeyBindings }),
      });

      const [first, second] = await bindings.attach([row("key-1"), row("key-2", "org-2")]);

      expect(listApiKeyBindings).toHaveBeenCalledTimes(2);
      expect(first?.roleBindings).toEqual([
        {
          id: "grant-key-1",
          role: "VIEWER",
          customRoleId: null,
          scopeType: "PROJECT",
          scopeId: "project-1",
        },
      ]);
      expect(second?.roleBindings).toMatchObject([{ scopeType: "ORGANIZATION", scopeId: "org-2" }]);
    });
  });

  describe("given a key the grants head holds nothing for", () => {
    it("answers it with no bindings rather than dropping it", async () => {
      const bindings = ApiKeyBindingsService.create({
        authz: createApiFixture<AuthzApi>({ listApiKeyBindings: async () => [] }),
      });

      await expect(bindings.attachOne(row("key-1"))).resolves.toMatchObject({
        id: "key-1",
        roleBindings: [],
      });
    });
  });

  describe("given a project", () => {
    it("names the keys granted on it, once each, and no other principal", async () => {
      const listScopeBindings = vi.fn(async () => [
        grant("key-1"),
        grant("key-1", { id: "grant-again" }),
        grant("key-9", { apiKeyId: null, userId: "user-1" }),
      ]);
      const bindings = ApiKeyBindingsService.create({
        authz: createApiFixture<AuthzApi>({ listScopeBindings }),
      });

      await expect(
        bindings.findKeyIdsReachingProject({ organizationId: "org-1", projectId: "project-1" }),
      ).resolves.toEqual(["key-1"]);
      expect(listScopeBindings).toHaveBeenCalledWith({
        organizationId: "org-1",
        scopeType: "PROJECT",
        scopeIds: ["project-1"],
      });
    });
  });
});
