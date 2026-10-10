import type {
  GatewayApi,
  GatewayMintedVirtualKey,
  GatewayVirtualKeyCreateCommand,
} from "@langwatch/gateway-contract";
import {
  LANGY_VK_SECRET_NAME,
  type CreateReservedSecretInput,
  type SecretApi,
} from "@langwatch/secret-contract";
/**
 * @vitest-environment node
 * @see modules/langy/specs/langy-virtual-key.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { LangyVirtualKeyGatewayService } from "../langy-virtual-key-gateway.service.ts";

const CREATED_AT = Temporal.Instant.from("2026-09-27T00:00:00Z");

function minted(secret: string): GatewayMintedVirtualKey {
  return {
    secret,
    virtualKey: {
      id: "vk_1",
      organizationId: "org_1",
      name: "Langy",
      description: null,
      status: "ACTIVE",
      purpose: "LANGY",
      externalId: null,
      metadata: {},
      disabledAt: null,
      disabledReason: null,
      expiresAt: null,
      hashedSecret: "hashed",
      displayPrefix: "lw_vk_",
      principalUserId: null,
      traceProjectId: null,
      config: {},
      revision: 1n,
      previousHashedSecret: null,
      previousSecretValidUntil: null,
      revokedAt: null,
      revokedById: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      createdById: "user_1",
      lastUsedAt: null,
      routingPolicyId: null,
      routingMode: "NONE",
      scopes: [],
      principalUser: null,
      routingPolicy: null,
    },
  };
}

function setup(input: { stored?: Record<string, string>; winner?: string }) {
  const mints: GatewayVirtualKeyCreateCommand[] = [];
  const writes: CreateReservedSecretInput[] = [];
  const secrets = createApiFixture<SecretApi>({
    getValues: async () => input.stored ?? {},
    createReserved: async (write) => {
      writes.push(write);
      return { value: input.winner ?? write.value };
    },
  });
  const gateway = input.stored
    ? createApiFixture<GatewayApi>()
    : createApiFixture<GatewayApi>({
        createVirtualKey: async (command) => {
          mints.push(command);
          return minted("vk-secret-minted");
        },
      });

  return {
    mints,
    writes,
    service: LangyVirtualKeyGatewayService.create({ secrets, gateway }),
  };
}

const PROVISION = { projectId: "project_1", organizationId: "org_1", actorUserId: "user_1" };

describe("LangyVirtualKeyGatewayService", () => {
  describe("given the project has no Langy key yet", () => {
    /** @scenario "Langy mints its project's gateway key on first need and keeps it" */
    it("mints a product-managed key scoped to the project and stores its secret", async () => {
      const { service, mints, writes } = setup({});

      await expect(service.provision(PROVISION)).resolves.toBe("vk-secret-minted");
      expect(mints).toEqual([
        {
          organizationId: "org_1",
          name: "Langy",
          description: "Auto-provisioned virtual key for the Langy in-product assistant.",
          principalUserId: null,
          scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
          actorUserId: "user_1",
          purpose: "LANGY",
        },
      ]);
      expect(writes).toEqual([
        {
          projectId: "project_1",
          name: LANGY_VK_SECRET_NAME,
          value: "vk-secret-minted",
          actorId: "user_1",
        },
      ]);
    });
  });

  describe("given the project already stores its Langy key", () => {
    /** @scenario "A project's stored Langy key is reused, never minted again" */
    it("answers the stored key without asking the gateway", async () => {
      const { service, writes } = setup({ stored: { [LANGY_VK_SECRET_NAME]: "vk-stored" } });

      await expect(service.provision(PROVISION)).resolves.toBe("vk-stored");
      expect(writes).toEqual([]);
    });
  });

  describe("when another caller stored a key first", () => {
    /** @scenario "Two first chats racing on one project agree on one key" */
    it("answers the key that was stored first", async () => {
      const { service } = setup({ winner: "vk-secret-winner" });

      await expect(service.provision(PROVISION)).resolves.toBe("vk-secret-winner");
    });
  });
});
