/**
 * Product-managed virtual keys (`purpose != USER` — today the Langy VK) are
 * provisioned and owned by the product, not the customer. The settings UI
 * badged and locked them, but that was presentation only: the tRPC router and
 * its public REST twin both reach the same service, and the service let every
 * by-id mutation through.
 *
 * `rotate` was the sharp edge — it returns a fresh plaintext secret AND breaks
 * Langy, because the gateway keeps authenticating against the secret Langy
 * still holds.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { VirtualKeyService } from "../virtualKey.service";

const REACHED_TRANSACTION = "REACHED_TRANSACTION";

function vkRow(purpose: "USER" | "LANGY") {
  return {
    id: "vk_1",
    organizationId: "org_1",
    name: purpose === "LANGY" ? "Langy" : "My key",
    purpose,
    status: "ACTIVE",
    config: {},
    scopes: [{ scopeType: "PROJECT", scopeId: "proj_1" }],
    routingPolicy: null,
    principalUser: null,
  };
}

function mockPrisma(row: unknown, findMany = vi.fn().mockResolvedValue([])) {
  return {
    virtualKey: {
      findFirst: vi.fn().mockResolvedValue(row),
      findMany,
    },
    // Reaching here means the guard let the mutation through.
    $transaction: vi.fn().mockRejectedValue(new Error(REACHED_TRANSACTION)),
  } as unknown as PrismaClient;
}

const mutationInput = {
  id: "vk_1",
  organizationId: "org_1",
  actorUserId: "user_1",
};

describe("VirtualKeyService product-managed guard", () => {
  describe("given a product-managed key", () => {
    it("reports it as absent on getById", async () => {
      const sut = VirtualKeyService.create(mockPrisma(vkRow("LANGY")));

      await expect(sut.getById("vk_1", "org_1")).resolves.toBeNull();
    });

    /** @scenario "Product-managed virtual keys refuse customer mutations" */
    it("refuses update with NOT_FOUND", async () => {
      const sut = VirtualKeyService.create(mockPrisma(vkRow("LANGY")));

      await expect(
        sut.update({ ...mutationInput, name: "renamed" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses rotate with NOT_FOUND, so no fresh secret is minted", async () => {
      const sut = VirtualKeyService.create(mockPrisma(vkRow("LANGY")));

      await expect(sut.rotate(mutationInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("refuses revoke with NOT_FOUND", async () => {
      const sut = VirtualKeyService.create(mockPrisma(vkRow("LANGY")));

      await expect(sut.revoke(mutationInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("given a customer-owned key", () => {
    it("returns it from getById", async () => {
      const sut = VirtualKeyService.create(mockPrisma(vkRow("USER")));

      await expect(sut.getById("vk_1", "org_1")).resolves.toMatchObject({
        id: "vk_1",
        purpose: "USER",
      });
    });

    it("lets a mutation past the guard", async () => {
      // Proves the guard is discriminating on purpose rather than refusing
      // everything: a USER key gets as far as the write transaction.
      const sut = VirtualKeyService.create(mockPrisma(vkRow("USER")));

      await expect(sut.revoke(mutationInput)).rejects.toThrow(
        REACHED_TRANSACTION,
      );
    });
  });

  describe("when listing keys", () => {
    /** @scenario "Product-managed virtual keys are absent from customer listings" */
    it("constrains the organization listing to customer-owned keys", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const sut = VirtualKeyService.create(
        mockPrisma(vkRow("USER"), findMany),
      );

      await sut.getAll("org_1");

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_1",
            purpose: "USER",
          }),
        }),
      );
    });

    it("constrains the scope listing to customer-owned keys", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const sut = VirtualKeyService.create(
        mockPrisma(vkRow("USER"), findMany),
      );

      await sut.getAllForScope({ scopeType: "PROJECT", scopeId: "proj_1" });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ purpose: "USER" }),
        }),
      );
    });
  });
});
