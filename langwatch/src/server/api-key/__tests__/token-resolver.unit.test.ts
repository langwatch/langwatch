import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { TokenResolver } from "../token-resolver";
import { generateApiKeyToken } from "../api-key-token.utils";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// A legacy project key whose random body happens to contain an underscore —
// the regression shape: it must resolve via the project lookup, not 401
const LEGACY_KEY_WITH_UNDERSCORE = "sk-lw-AbCdEfGhIjKlMnOpQrStUvWxYz012345_floM";

const project = {
  id: "project_1",
  apiKey: LEGACY_KEY_WITH_UNDERSCORE,
  archivedAt: null,
  team: { id: "team_1", organizationId: "org_1" },
};

function createMockPrisma(opts?: { projectFound?: boolean }) {
  return {
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts?.projectFound === false ? null : project),
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
      it("resolves to the project via the legacy lookup", async () => {
        const prisma = createMockPrisma();
        const resolver = TokenResolver.create(prisma);

        const resolved = await resolver.resolve({
          token: LEGACY_KEY_WITH_UNDERSCORE,
        });

        expect(resolved).not.toBeNull();
        expect(resolved!.type).toBe("legacyProjectKey");
        expect(resolved!.project.id).toBe("project_1");
        expect(prisma.project.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { apiKey: LEGACY_KEY_WITH_UNDERSCORE, archivedAt: null },
          }),
        );
      });
    });

    describe("when a new-format sk-lw- token misses the ApiKey lookup", () => {
      it("falls back to the legacy project key lookup", async () => {
        const prisma = createMockPrisma();
        const resolver = TokenResolver.create(prisma);
        const { token } = generateApiKeyToken();

        const resolved = await resolver.resolve({ token });

        expect(resolved).not.toBeNull();
        expect(resolved!.type).toBe("legacyProjectKey");
        expect(prisma.project.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { apiKey: token, archivedAt: null },
          }),
        );
      });

      it("returns null when the legacy fallback also misses", async () => {
        const prisma = createMockPrisma({ projectFound: false });
        const resolver = TokenResolver.create(prisma);
        const { token } = generateApiKeyToken();

        const resolved = await resolver.resolve({ token });

        expect(resolved).toBeNull();
      });
    });
  });
});
