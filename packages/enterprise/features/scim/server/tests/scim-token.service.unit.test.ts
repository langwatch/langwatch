// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScimEntitlementProvider,
  type ScimTokenService,
} from "../src/services/scim-token.service";
import { PostgresScimTokenAdapter } from "../src/adapters/postgres.postgres.adapter";
import type { ScimTokenDatabase } from "../src/ports/scim-token-database.port";

function createMockPrisma() {
  return {
    scimToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  } as unknown as ScimTokenDatabase;
}

class FakeEntitlements extends ScimEntitlementProvider {
  readonly isEntitled = vi.fn(async () => true);
}

describe("ScimTokenService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ScimTokenService;
  let entitlements: FakeEntitlements;

  beforeEach(() => {
    prisma = createMockPrisma();
    entitlements = new FakeEntitlements();
    service = PostgresScimTokenAdapter.create({
      database: prisma,
      entitlements,
    }).build();
  });

  describe("when generating a token", () => {
    describe("given an organization id", () => {
      it("creates a token record with a hashed value", async () => {
        const mockToken = { id: "token-1", organizationId: "org-1" };
        (prisma.scimToken.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockToken,
        );

        const result = await service.generate({ organizationId: "org-1" });

        expect(result.token).toBeDefined();
        expect(result.token.length).toBe(64); // 32 bytes hex
        expect(result.tokenId).toBe("token-1");

        const createCall = (prisma.scimToken.create as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(createCall.data.organizationId).toBe("org-1");
        expect(createCall.data.hashedToken).toBe(
          crypto.createHash("sha256").update(result.token).digest("hex"),
        );
      });

      it("stores the description when provided", async () => {
        const mockToken = { id: "token-1" };
        (prisma.scimToken.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockToken,
        );

        await service.generate({
          organizationId: "org-1",
          description: "Okta integration",
        });

        const createCall = (prisma.scimToken.create as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(createCall.data.description).toBe("Okta integration");
      });
    });
  });

  describe("when verifying a token against the plan", () => {
    const hashedToken = crypto
      .createHash("sha256")
      .update("valid-token")
      .digest("hex");

    beforeEach(() => {
      entitlements.isEntitled.mockReset();
      entitlements.isEntitled.mockResolvedValue(true);
    });

    describe("when the token does not exist", () => {
      it("reports an invalid token without consulting the plan", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.verifyEntitled({ token: "unknown" });

        expect(result).toEqual({ status: "invalid_token" });
        expect(entitlements.isEntitled).not.toHaveBeenCalled();
      });
    });

    describe("when the token is valid and the organization is on Enterprise", () => {
      it("returns ok with the organization id", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken,
        });
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});
        entitlements.isEntitled.mockResolvedValue(true);

        const result = await service.verifyEntitled({ token: "valid-token" });

        expect(result).toEqual({ status: "ok", organizationId: "org-1" });
        expect(entitlements.isEntitled).toHaveBeenCalledWith("org-1");
      });
    });

    describe("when the token is valid but the plan has lapsed", () => {
      it("reports the plan as not entitled so the token cannot outlive Enterprise", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken,
        });
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});
        entitlements.isEntitled.mockResolvedValue(false);

        const result = await service.verifyEntitled({ token: "valid-token" });

        expect(result).toEqual({
          status: "plan_not_entitled",
          organizationId: "org-1",
        });
        expect(prisma.scimToken.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("when listing an organization's tokens", () => {
    it("selects only the safe fields, never the stored hash", async () => {
      (prisma.scimToken.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [],
      );

      await service.list({ organizationId: "org-1" });

      expect(prisma.scimToken.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        select: {
          id: true,
          description: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("when revoking a token", () => {
    describe("given the token belongs to the organization", () => {
      it("deletes it in a single scoped statement", async () => {
        (
          prisma.scimToken.deleteMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ count: 1 });

        const result = await service.revoke({
          organizationId: "org-1",
          tokenId: "token-1",
        });

        expect(result).toEqual({ success: true });
        expect(prisma.scimToken.deleteMany).toHaveBeenCalledWith({
          where: { id: "token-1", organizationId: "org-1" },
        });
      });
    });

    describe("given the token id is unknown or from another organization", () => {
      it("answers not found", async () => {
        (
          prisma.scimToken.deleteMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ count: 0 });

        await expect(
          service.revoke({ organizationId: "org-1", tokenId: "foreign" }),
        ).rejects.toMatchObject({ code: "scim_token_not_found" });
      });
    });
  });

  describe("when verifying a token", () => {
    describe("given the token exists", () => {
      it("returns the organization ID and updates lastUsedAt", async () => {
        const hashedToken = crypto
          .createHash("sha256")
          .update("valid-token")
          .digest("hex");

        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken,
        });
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({});

        const result = await service.tryVerify({ token: "valid-token" });

        expect(result).toEqual({ organizationId: "org-1" });
        expect(prisma.scimToken.findFirst).toHaveBeenCalledWith({
          where: { hashedToken },
        });
        expect(prisma.scimToken.updateMany).toHaveBeenCalledWith({
          where: { id: "token-1" },
          data: { lastUsedAt: expect.any(Date) },
        });
      });
    });

    describe("given an administrator revokes the token mid-verification", () => {
      it("still answers the caller instead of failing on the vanished row", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken: crypto
            .createHash("sha256")
            .update("valid-token")
            .digest("hex"),
        });
        // What the revoke leaves behind: the row is gone by the time the use
        // is recorded, so the write matches nothing. A single-row `update`
        // would raise P2025 here and turn the race into a 500.
        (
          prisma.scimToken.updateMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ count: 0 });

        await expect(service.tryVerify({ token: "valid-token" })).resolves.toEqual(
          { organizationId: "org-1" },
        );
      });
    });

    describe("given the token does not exist", () => {
      it("returns null", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.tryVerify({ token: "invalid-token" });

        expect(result).toBeNull();
        expect(prisma.scimToken.updateMany).not.toHaveBeenCalled();
      });
    });
  });
});
