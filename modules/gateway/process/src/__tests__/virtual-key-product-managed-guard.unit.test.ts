/**
 * Product-managed virtual keys (`purpose != USER` — today the Langy VK) are
 * owned by the product, not the customer. The settings UI badged and locked
 * them, but that was presentation only — the service let every mutation through.
 */

import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { Temporal, toDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PostgresVirtualKeyAdapter } from "./testing.ts";

const { createVirtualKeyServiceForTest } = PostgresVirtualKeyAdapter;
const REACHED_TRANSACTION = "REACHED_TRANSACTION";
/** The stored row carries the columns Prisma always returns, as Prisma returns them. */
const MINTED_AT = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

function vkRow(purpose: "USER" | "LANGY" | "CONNECT") {
  return {
    id: "vk_1",
    organizationId: "org_1",
    name: { USER: "My key", LANGY: "Langy", CONNECT: "Connect lic-1" }[purpose],
    purpose,
    status: "ACTIVE",
    config: {},
    scopes: [{ scopeType: "PROJECT", scopeId: "proj_1" }],
    routingPolicy: null,
    principalUser: null,
    createdAt: toDate(MINTED_AT),
    updatedAt: toDate(MINTED_AT),
  };
}

function mockPrisma(row: unknown, findMany = vi.fn().mockResolvedValue([])) {
  return prismaDouble({
    virtualKey: {
      findFirst: vi.fn().mockResolvedValue(row),
      findMany,
    },
    // Reaching here means the guard let the mutation through.
    $transaction: vi.fn().mockRejectedValue(new Error(REACHED_TRANSACTION)),
  });
}

const mutationInput = {
  id: "vk_1",
  organizationId: "org_1",
  actorUserId: "user_1",
};

describe("VirtualKeyService product-managed guard", () => {
  describe("given a product-managed key", () => {
    /** @scenario Product-managed keys refuse customer-facing reads and mutations */
    it("reports it as absent on findById", async () => {
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("LANGY")),
        createApiFixture<ProjectApi>(),
      );

      await expect(sut.findById("vk_1", "org_1")).resolves.toBeNull();
    });

    /** @scenario "Product-managed virtual keys refuse customer mutations" */
    it("refuses update with NOT_FOUND", async () => {
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("LANGY")),
        createApiFixture<ProjectApi>(),
      );

      await expect(sut.update({ ...mutationInput, name: "renamed" })).rejects.toMatchObject({
        code: "virtual_key_not_found",
      });
    });

    /** @scenario Product-managed keys refuse customer-facing reads and mutations */
    it("refuses rotate with NOT_FOUND, so no fresh secret is minted", async () => {
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("LANGY")),
        createApiFixture<ProjectApi>(),
      );

      await expect(sut.rotate(mutationInput)).rejects.toMatchObject({
        code: "virtual_key_not_found",
      });
    });

    it("refuses revoke with NOT_FOUND", async () => {
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("LANGY")),
        createApiFixture<ProjectApi>(),
      );

      await expect(sut.revoke(mutationInput)).rejects.toMatchObject({
        code: "virtual_key_not_found",
      });
    });
  });

  describe("given the managed key of a hosted-services license", () => {
    /** @scenario The managed key is not visible or editable as a customer key */
    it("is absent from the organization listing, and a customer revoke is refused", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("CONNECT"), findMany),
        createApiFixture<ProjectApi>(),
      );

      await sut.getAll("org_1");

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ purpose: "USER" }) }),
      );
      await expect(sut.findById("vk_1", "org_1")).resolves.toBeNull();
      await expect(sut.revoke(mutationInput)).rejects.toMatchObject({
        code: "virtual_key_not_found",
      });
    });
  });

  describe("given a customer-owned key", () => {
    it("returns it from findById", async () => {
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("USER")),
        createApiFixture<ProjectApi>(),
      );

      await expect(sut.findById("vk_1", "org_1")).resolves.toMatchObject({
        id: "vk_1",
        purpose: "USER",
      });
    });

    it("lets a mutation past the guard", async () => {
      // Proves the guard is discriminating on purpose rather than refusing
      // everything: a USER key gets as far as the write transaction.
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("USER")),
        createApiFixture<ProjectApi>(),
      );

      await expect(sut.revoke(mutationInput)).rejects.toThrow(REACHED_TRANSACTION);
    });
  });

  describe("when listing keys", () => {
    /** @scenario "Product-managed virtual keys are absent from customer listings" */
    it("constrains the organization listing to customer-owned keys", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("USER"), findMany),
        createApiFixture<ProjectApi>(),
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
      const sut = createVirtualKeyServiceForTest(
        mockPrisma(vkRow("USER"), findMany),
        createApiFixture<ProjectApi>(),
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
