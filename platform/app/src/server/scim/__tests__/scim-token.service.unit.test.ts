import crypto from "crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScimTokenService } from "../scim-token.service";

function createMockPrisma() {
  return {
    scimToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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
          mockToken
        );

        const result = await service.generate({ organizationId: "org-1" });

        expect(result.token).toBeDefined();
        expect(result.token.length).toBe(64); // 32 bytes hex
        expect(result.tokenId).toBe("token-1");

        const createCall = (prisma.scimToken.create as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(createCall.data.organizationId).toBe("org-1");
        expect(createCall.data.hashedToken).toBe(
          crypto.createHash("sha256").update(result.token).digest("hex")
        );
      });

      it("stores the description when provided", async () => {
        const mockToken = { id: "token-1" };
        (prisma.scimToken.create as ReturnType<typeof vi.fn>).mockResolvedValue(
          mockToken
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

  describe("verify()", () => {
    describe("when the token exists", () => {
      it("returns the organization ID and updates lastUsedAt", async () => {
        const hashedToken = crypto
          .createHash("sha256")
          .update("valid-token")
          .digest("hex");

        (prisma.scimToken.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
          id: "token-1",
          organizationId: "org-1",
          hashedToken,
        });
        (prisma.scimToken.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

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
        (prisma.scimToken.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
          null
        );

        const result = await service.verify({ token: "invalid-token" });

        expect(result).toBeNull();
        expect(prisma.scimToken.update).not.toHaveBeenCalled();
      });
    });
  });
});
