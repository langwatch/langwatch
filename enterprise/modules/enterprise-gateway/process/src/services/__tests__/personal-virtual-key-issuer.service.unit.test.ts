// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createApiFixture } from "@langwatch/api-fixture";
import type { GatewayApi, GatewayVirtualKeyRecord } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PersonalVirtualKeyIssuerService } from "../personal-virtual-key-issuer.service.ts";

function virtualKeyRecord(
  overrides: Partial<GatewayVirtualKeyRecord> = {},
): GatewayVirtualKeyRecord {
  const now = Temporal.Instant.fromEpochMilliseconds(0);
  return {
    id: "vk_1",
    organizationId: "org_1",
    name: "Personal virtual key",
    description: "Personal virtual key",
    status: "ACTIVE",
    purpose: "USER",
    externalId: null,
    metadata: null,
    disabledAt: null,
    disabledReason: null,
    expiresAt: null,
    hashedSecret: "hashed",
    displayPrefix: "vk_abc",
    principalUserId: "user_1",
    traceProjectId: null,
    config: null,
    revision: 1n,
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
    createdById: "user_1",
    lastUsedAt: null,
    routingPolicyId: null,
    routingMode: "NONE",
    scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
    principalUser: null,
    routingPolicy: null,
    ...overrides,
  };
}

describe("PersonalVirtualKeyIssuerService", () => {
  describe("when a personal key is issued", () => {
    it("mints a project-scoped virtual key through the gateway and maps it back", async () => {
      const createVirtualKey = vi.fn().mockResolvedValue({
        virtualKey: virtualKeyRecord(),
        secret: "sk-secret",
      });
      const gateway = createApiFixture<GatewayApi>({ createVirtualKey });
      const issuer = PersonalVirtualKeyIssuerService.create(gateway);

      const result = await issuer.issue({
        organizationId: "org_1",
        userId: "user_1",
        personalProjectId: "project_1",
        label: "My key",
        routingPolicyId: null,
      });

      expect(createVirtualKey).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          name: "My key",
          principalUserId: "user_1",
          scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
          actorUserId: "user_1",
        }),
      );
      expect(result.secret).toBe("sk-secret");
      expect(result.virtualKey).toMatchObject({
        id: "vk_1",
        organizationId: "org_1",
        scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
      });
    });
  });

  describe("when a personal key is revoked", () => {
    it("revokes it through the gateway and maps the answer back", async () => {
      const revokeVirtualKey = vi.fn().mockResolvedValue(virtualKeyRecord({ status: "REVOKED" }));
      const gateway = createApiFixture<GatewayApi>({ revokeVirtualKey });
      const issuer = PersonalVirtualKeyIssuerService.create(gateway);

      const result = await issuer.revoke({
        id: "vk_1",
        organizationId: "org_1",
        actorUserId: "user_1",
      });

      expect(revokeVirtualKey).toHaveBeenCalledWith({
        id: "vk_1",
        organizationId: "org_1",
        actorUserId: "user_1",
      });
      expect(result.status).toBe("REVOKED");
    });
  });
});
