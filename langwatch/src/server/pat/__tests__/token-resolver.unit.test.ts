import { describe, it, expect, vi, beforeEach } from "vitest";
import { TokenResolver } from "../token-resolver";
import { generatePatToken } from "../pat-token.utils";

function createMockPrisma() {
  return {
    project: {
      findUnique: vi.fn(),
    },
    personalAccessToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  } as any;
}

describe("TokenResolver", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let resolver: TokenResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    resolver = TokenResolver.create(prisma);
  });

  describe("when resolving a legacy sk-lw-* token", () => {
    it("looks up the project by apiKey", async () => {
      const mockProject = {
        id: "proj-1",
        apiKey: "sk-lw-testkey123",
        archivedAt: null,
        team: { id: "team-1", organizationId: "org-1" },
      };
      prisma.project.findUnique.mockResolvedValue(mockProject);

      const result = await resolver.resolve({ token: "sk-lw-testkey123" });

      expect(result).toEqual({
        type: "legacy",
        project: mockProject,
      });
    });

    it("returns null for invalid legacy keys", async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      const result = await resolver.resolve({ token: "sk-lw-invalid" });
      expect(result).toBeNull();
    });
  });

  describe("when resolving a pat-lw-* token", () => {
    it("verifies the PAT and returns project context", async () => {
      const { token, lookupId, hashedSecret } = generatePatToken();
      const mockPat = {
        id: "pat-1",
        lookupId,
        hashedSecret,
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: null,
        roleBindings: [],
      };
      const mockProject = {
        id: "proj-1",
        archivedAt: null,
        team: { id: "team-1", organizationId: "org-1" },
      };

      prisma.personalAccessToken.findUnique.mockResolvedValue(mockPat);
      prisma.personalAccessToken.update.mockResolvedValue({});
      prisma.project.findUnique.mockResolvedValue(mockProject);

      const result = await resolver.resolve({
        token,
        projectId: "proj-1",
      });

      expect(result).toEqual({
        type: "pat",
        patId: "pat-1",
        userId: "user-1",
        organizationId: "org-1",
        project: mockProject,
      });
    });

    it("returns null when no projectId is provided", async () => {
      const { token, lookupId, hashedSecret } = generatePatToken();
      prisma.personalAccessToken.findUnique.mockResolvedValue({
        id: "pat-1",
        lookupId,
        hashedSecret,
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: null,
        roleBindings: [],
      });
      prisma.personalAccessToken.update.mockResolvedValue({});

      const result = await resolver.resolve({ token });
      expect(result).toBeNull();
    });

    it("returns null when project is in a different org", async () => {
      const { token, lookupId, hashedSecret } = generatePatToken();
      prisma.personalAccessToken.findUnique.mockResolvedValue({
        id: "pat-1",
        lookupId,
        hashedSecret,
        userId: "user-1",
        organizationId: "org-1",
        revokedAt: null,
        roleBindings: [],
      });
      prisma.personalAccessToken.update.mockResolvedValue({});
      prisma.project.findUnique.mockResolvedValue({
        id: "proj-1",
        archivedAt: null,
        team: { id: "team-1", organizationId: "org-OTHER" },
      });

      const result = await resolver.resolve({
        token,
        projectId: "proj-1",
      });
      expect(result).toBeNull();
    });
  });

  describe("when resolving unknown token types", () => {
    it("falls back to legacy lookup", async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      const result = await resolver.resolve({ token: "unknown-prefix-token" });
      expect(result).toBeNull();
    });
  });
});
