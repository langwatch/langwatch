import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { generateApiKeyToken } from "../api-key-token.utils";
import { hashProjectApiKey } from "../project-api-key";
import { TokenResolver } from "../token-resolver";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// A legacy project key whose random body happens to contain an underscore —
// the regression shape: it must resolve via the project lookup, not 401
const LEGACY_KEY_WITH_UNDERSCORE =
  "sk-lw-AbCdEfGhIjKlMnOpQrStUvWxYz012345_floM";

/** A project whose key is stored as a hash only. */
function hashedProject(token: string) {
  return {
    id: "project_1",
    apiKey: null,
    apiKeyHash: hashProjectApiKey(token),
    archivedAt: null,
    team: { id: "team_1", organizationId: "org_1" },
  };
}

/**
 * Answers `project.findUnique` by the `apiKeyHash` it is asked for, the way
 * the unique index does, and misses every other lookup.
 */
function createMockPrisma(opts: { storedToken: string | null }) {
  const row = opts.storedToken ? hashedProject(opts.storedToken) : null;
  return {
    project: {
      findUnique: vi.fn(
        async ({ where }: { where: { apiKeyHash?: string } }) =>
          row && where.apiKeyHash === row.apiKeyHash ? row : null,
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    projectInternalKey: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("TokenResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolve", () => {
    describe("when given a legacy project key containing an underscore", () => {
      it("resolves to the project by the key's hash", async () => {
        const prisma = createMockPrisma({
          storedToken: LEGACY_KEY_WITH_UNDERSCORE,
        });
        const resolver = TokenResolver.create(prisma);

        const resolved = await resolver.resolve({
          token: LEGACY_KEY_WITH_UNDERSCORE,
        });

        expect(resolved).not.toBeNull();
        expect(resolved!.type).toBe("legacyProjectKey");
        expect(resolved!.project.id).toBe("project_1");
        expect(prisma.project.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              apiKeyHash: hashProjectApiKey(LEGACY_KEY_WITH_UNDERSCORE),
            },
          }),
        );
      });
    });

    describe("when a new-format sk-lw- token misses the ApiKey lookup", () => {
      it("falls back to the project key lookup", async () => {
        const { token } = generateApiKeyToken();
        const prisma = createMockPrisma({ storedToken: token });
        const resolver = TokenResolver.create(prisma);

        const resolved = await resolver.resolve({ token });

        expect(resolved).not.toBeNull();
        expect(resolved!.type).toBe("legacyProjectKey");
        expect(prisma.project.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { apiKeyHash: hashProjectApiKey(token) },
          }),
        );
      });

      it("returns null when the project key lookup also misses", async () => {
        const prisma = createMockPrisma({ storedToken: null });
        const resolver = TokenResolver.create(prisma);
        const { token } = generateApiKeyToken();

        const resolved = await resolver.resolve({ token });

        expect(resolved).toBeNull();
      });
    });
  });
});
