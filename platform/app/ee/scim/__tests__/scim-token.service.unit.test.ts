// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScimTokenService } from "../scim-token.service";

function createMockPrisma() {
  return {
    scimToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as Parameters<typeof ScimTokenService.create>[0];
}

describe("ScimTokenService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ScimTokenService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = ScimTokenService.create(prisma);
  });

  describe("generate()", () => {
    describe("when called with an organization ID", () => {
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

  describe("verifyEntitled()", () => {
    const getActivePlan = vi.fn();
    const planProvider = { getActivePlan };
    const hashedToken = crypto
      .createHash("sha256")
      .update("valid-token")
      .digest("hex");

    beforeEach(() => {
      getActivePlan.mockReset();
      service = ScimTokenService.create(prisma, { planProvider });
    });

    describe("when the token does not exist", () => {
      it("reports an invalid token without consulting the plan", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.verifyEntitled({ token: "unknown" });

        expect(result).toEqual({ status: "invalid_token" });
        expect(getActivePlan).not.toHaveBeenCalled();
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
        (prisma.scimToken.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          {},
        );
        getActivePlan.mockResolvedValue({ type: "ENTERPRISE" });

        const result = await service.verifyEntitled({ token: "valid-token" });

        expect(result).toEqual({ status: "ok", organizationId: "org-1" });
        expect(getActivePlan).toHaveBeenCalledWith({
          organizationId: "org-1",
        });
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
        (prisma.scimToken.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          {},
        );
        getActivePlan.mockResolvedValue({ type: "FREE" });

        const result = await service.verifyEntitled({ token: "valid-token" });

        expect(result).toEqual({
          status: "plan_not_entitled",
          organizationId: "org-1",
        });
      });
    });
  });

  describe("list()", () => {
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

  describe("revoke()", () => {
    describe("when the token belongs to the organization", () => {
      it("deletes it", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ id: "token-1" });
        (prisma.scimToken.delete as ReturnType<typeof vi.fn>).mockResolvedValue(
          {},
        );

        const result = await service.revoke({
          organizationId: "org-1",
          tokenId: "token-1",
        });

        expect(result).toEqual({ success: true });
        expect(prisma.scimToken.delete).toHaveBeenCalledWith({
          where: { id: "token-1", organizationId: "org-1" },
        });
      });
    });

    describe("when the token id is unknown or from another organization", () => {
      it("answers not found and deletes nothing", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        await expect(
          service.revoke({ organizationId: "org-1", tokenId: "foreign" }),
        ).rejects.toMatchObject({ code: "scim_token_not_found" });

        expect(prisma.scimToken.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe("verify()", () => {
    describe("when the token exists", () => {
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
        (prisma.scimToken.update as ReturnType<typeof vi.fn>).mockResolvedValue(
          {},
        );

        const result = await service.verify({ token: "valid-token" });

        expect(result).toEqual({ organizationId: "org-1" });
        expect(prisma.scimToken.findFirst).toHaveBeenCalledWith({
          where: { hashedToken },
        });
        expect(prisma.scimToken.update).toHaveBeenCalledWith({
          where: { id: "token-1" },
          data: { lastUsedAt: expect.any(Date) },
        });
      });
    });

    describe("when the token does not exist", () => {
      it("returns null", async () => {
        (
          prisma.scimToken.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);

        const result = await service.verify({ token: "invalid-token" });

        expect(result).toBeNull();
        expect(prisma.scimToken.update).not.toHaveBeenCalled();
      });
    });
  });
});
