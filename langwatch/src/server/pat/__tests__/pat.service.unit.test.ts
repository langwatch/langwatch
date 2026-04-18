import { describe, it, expect, vi, beforeEach } from "vitest";
import { PatService } from "../pat.service";
import { generatePatToken, hashSecret } from "../pat-token.utils";

// Mock PrismaClient
function createMockPrisma() {
  const mock = {
    personalAccessToken: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    roleBinding: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn((cb: (tx: any) => Promise<any>) => cb(mock)),
  } as any;
  return mock;
}

describe("PatService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: PatService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = PatService.create(prisma);
  });

  describe("create", () => {
    it("creates a PAT and returns the plaintext token", async () => {
      prisma.personalAccessToken.create.mockResolvedValue({
        id: "pat-1",
        name: "CI Pipeline",
        lookupId: "abc123",
        hashedSecret: "hash",
        userId: "user-1",
        organizationId: "org-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      });

      prisma.roleBinding.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create({
        name: "CI Pipeline",
        userId: "user-1",
        organizationId: "org-1",
        bindings: [
          { role: "MEMBER", scopeType: "ORGANIZATION", scopeId: "org-1" },
        ],
      });

      expect(result.token).toMatch(/^pat-lw-/);
      expect(result.pat.id).toBe("pat-1");
      expect(result.pat.name).toBe("CI Pipeline");
      expect(prisma.personalAccessToken.create).toHaveBeenCalledOnce();
      expect(prisma.roleBinding.createMany).toHaveBeenCalledOnce();
    });
  });

  describe("verify", () => {
    it("verifies a valid token and returns the PAT record", async () => {
      const { token, lookupId, hashedSecret } = generatePatToken();

      prisma.personalAccessToken.findFirst.mockResolvedValue({
        id: "pat-1",
        lookupId,
        hashedSecret,
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: null,
        roleBindings: [{ role: "MEMBER", scopeType: "ORGANIZATION", scopeId: "org-1" }],
      });

      const result = await service.verify({ token });

      expect(result).not.toBeNull();
      expect(result!.id).toBe("pat-1");
    });

    it("returns null for wrong secret", async () => {
      const { lookupId } = generatePatToken();
      const wrongToken = `pat-lw-${lookupId}_wrongsecretvalue123456789012345678901234567`;

      prisma.personalAccessToken.findFirst.mockResolvedValue({
        id: "pat-1",
        lookupId,
        hashedSecret: hashSecret("correctSecret"),
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: null,
        roleBindings: [],
      });

      const result = await service.verify({ token: wrongToken });
      expect(result).toBeNull();
    });

    it("returns null for revoked tokens", async () => {
      const { token, lookupId, hashedSecret } = generatePatToken();

      prisma.personalAccessToken.findFirst.mockResolvedValue({
        id: "pat-1",
        lookupId,
        hashedSecret,
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: new Date(),
        roleBindings: [],
      });

      const result = await service.verify({ token });
      expect(result).toBeNull();
    });

    it("returns null for expired tokens", async () => {
      const { token, lookupId, hashedSecret } = generatePatToken();

      prisma.personalAccessToken.findFirst.mockResolvedValue({
        id: "pat-1",
        lookupId,
        hashedSecret,
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
        roleBindings: [],
      });

      const result = await service.verify({ token });
      expect(result).toBeNull();
    });

    it("accepts tokens with a future expiration", async () => {
      const { token, lookupId, hashedSecret } = generatePatToken();

      prisma.personalAccessToken.findFirst.mockResolvedValue({
        id: "pat-1",
        lookupId,
        hashedSecret,
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000), // expires tomorrow
        roleBindings: [],
      });

      const result = await service.verify({ token });
      expect(result).not.toBeNull();
      expect(result!.id).toBe("pat-1");
    });

    it("returns null for non-existent tokens", async () => {
      prisma.personalAccessToken.findFirst.mockResolvedValue(null);

      const result = await service.verify({
        token: "pat-lw-nonexistent_secret123456789012345678901234567890",
      });
      expect(result).toBeNull();
    });

    it("returns null for invalid token format", async () => {
      const result = await service.verify({ token: "not-a-pat" });
      expect(result).toBeNull();
    });
  });

  describe("revoke", () => {
    it("revokes a PAT owned by the user", async () => {
      prisma.personalAccessToken.findUnique.mockResolvedValue({
        id: "pat-1",
        userId: "user-1",
        revokedAt: null,
        roleBindings: [],
      });
      prisma.personalAccessToken.update.mockResolvedValue({
        id: "pat-1",
        revokedAt: new Date(),
      });

      const result = await service.revoke({ id: "pat-1", userId: "user-1" });
      expect(result.revokedAt).toBeTruthy();
    });

    it("throws when PAT is not found", async () => {
      prisma.personalAccessToken.findUnique.mockResolvedValue(null);

      await expect(
        service.revoke({ id: "nonexistent", userId: "user-1" }),
      ).rejects.toThrow("not found");
    });

    it("throws when user does not own the PAT", async () => {
      prisma.personalAccessToken.findUnique.mockResolvedValue({
        id: "pat-1",
        userId: "other-user",
        revokedAt: null,
        roleBindings: [],
      });

      await expect(
        service.revoke({ id: "pat-1", userId: "user-1" }),
      ).rejects.toThrow("Not authorized");
    });

    it("throws when PAT is already revoked", async () => {
      prisma.personalAccessToken.findUnique.mockResolvedValue({
        id: "pat-1",
        userId: "user-1",
        revokedAt: new Date(),
        roleBindings: [],
      });

      await expect(
        service.revoke({ id: "pat-1", userId: "user-1" }),
      ).rejects.toThrow("already revoked");
    });
  });

  describe("list", () => {
    it("returns PATs for a user in an organization", async () => {
      prisma.personalAccessToken.findMany.mockResolvedValue([
        {
          id: "pat-1",
          name: "Token A",
          roleBindings: [],
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
        },
        {
          id: "pat-2",
          name: "Token B",
          roleBindings: [],
          createdAt: new Date(),
          lastUsedAt: new Date(),
          revokedAt: null,
        },
      ]);

      const result = await service.list({
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("Token A");
    });
  });
});
