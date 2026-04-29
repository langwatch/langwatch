import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the encryption module before importing the repository
vi.mock("../../../utils/encryption", () => ({
  encrypt: vi.fn((text: string) => `mock-iv:mock-encrypted-${text}:mock-tag`),
  decrypt: vi.fn((encrypted: string) => {
    const match = encrypted.match(/^mock-iv:mock-encrypted-(.+):mock-tag$/);
    if (!match) throw new Error("Invalid encrypted string format");
    return match[1]!;
  }),
}));

import type { ModelProvider, ModelProviderScope, PrismaClient } from "@prisma/client";
import {
  ModelProviderRepository,
  type ModelProviderWithScopes,
} from "../modelProvider.repository";
import { encrypt, decrypt } from "../../../utils/encryption";

function createMockPrisma() {
  return {
    modelProvider: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    modelProviderScope: {
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) =>
      typeof cb === "function" ? cb(prismaForTxRef) : cb,
    ),
  } as unknown as PrismaClient;
}

// Trick so the mocked $transaction can pass back a "tx client" shape.
// Each createMockPrisma() call replaces prismaForTxRef via the factory
// used by the repository test harness below.
let prismaForTxRef: PrismaClient;

function createScope(
  scopeType: "PROJECT" | "TEAM" | "ORGANIZATION",
  scopeId: string,
  modelProviderId: string,
): ModelProviderScope {
  return {
    id: `mps_${scopeType}_${scopeId}`,
    modelProviderId,
    scopeType,
    scopeId,
    createdAt: new Date(),
  };
}

function createModelProvider(
  overrides: Partial<ModelProviderWithScopes> & {
    scopes?: ModelProviderScope[];
  } = {},
): ModelProviderWithScopes {
  const { scopes, ...rest } = overrides;
  const id = rest.id ?? "mp_test123";
  const projectId = rest.projectId ?? "proj_test";
  return {
    id,
    projectId,
    name: "OpenAI",
    provider: "openai",
    enabled: true,
    customKeys: null,
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    scopes: scopes ?? [createScope("PROJECT", projectId, id)],
    ...rest,
  };
}

describe("ModelProviderRepository", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let repository: ModelProviderRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    prismaForTxRef = prisma as unknown as PrismaClient;
    repository = new ModelProviderRepository(prisma);
  });

  describe("encryptCustomKeys", () => {
    describe("when given a Record of keys", () => {
      it("produces an encrypted string", () => {
        const keys = { OPENAI_API_KEY: "sk-secret123" };
        const result = (repository as any).encryptCustomKeys(keys);

        expect(typeof result).toBe("string");
        expect(encrypt).toHaveBeenCalledWith(JSON.stringify(keys));
      });

      it("calls encrypt with the JSON-serialized keys", () => {
        const keys = { OPENAI_API_KEY: "sk-secret123" };
        (repository as any).encryptCustomKeys(keys);

        expect(encrypt).toHaveBeenCalledWith(JSON.stringify(keys));
      });

      it("produces a value that is not valid JSON for an object", () => {
        const keys = { OPENAI_API_KEY: "sk-secret123" };
        const result = (repository as any).encryptCustomKeys(keys);

        let parsed: unknown;
        try {
          parsed = JSON.parse(result);
        } catch {
          parsed = undefined;
        }
        // The encrypted string should not parse to an object
        expect(typeof parsed).not.toBe("object");
      });
    });

    describe("when given null", () => {
      it("returns null", () => {
        const result = (repository as any).encryptCustomKeys(null);
        expect(result).toBeNull();
      });
    });

    describe("when given undefined", () => {
      it("returns undefined", () => {
        const result = (repository as any).encryptCustomKeys(undefined);
        expect(result).toBeUndefined();
      });
    });
  });

  describe("decryptCustomKeys", () => {
    describe("when given an encrypted string", () => {
      it("round-trips correctly with encryptCustomKeys", () => {
        const original = { OPENAI_API_KEY: "sk-secret123", BASE_URL: "https://api.openai.com" };
        const encrypted = (repository as any).encryptCustomKeys(original);
        const decrypted = (repository as any).decryptCustomKeys(encrypted);

        expect(decrypted).toEqual(original);
      });
    });

    describe("when given a plaintext object (migration compatibility)", () => {
      it("returns the object as-is", () => {
        const plaintext = { OPENAI_API_KEY: "sk-secret123" };
        const result = (repository as any).decryptCustomKeys(plaintext);

        expect(result).toEqual(plaintext);
        expect(decrypt).not.toHaveBeenCalled();
      });
    });

    describe("when given null", () => {
      it("returns null", () => {
        const result = (repository as any).decryptCustomKeys(null);
        expect(result).toBeNull();
      });
    });

    describe("when given undefined", () => {
      it("returns null", () => {
        const result = (repository as any).decryptCustomKeys(undefined);
        expect(result).toBeNull();
      });
    });
  });

  describe("findById()", () => {
    describe("when provider exists", () => {
      it("decrypts customKeys before returning", async () => {
        const encrypted = (repository as any).encryptCustomKeys({
          OPENAI_API_KEY: "sk-secret",
        });
        const stored = createModelProvider({ customKeys: encrypted });
        (prisma.modelProvider.findFirst as any).mockResolvedValue(stored);

        const result = await repository.findById("mp_test123", "proj_test");

        expect(result).not.toBeNull();
        expect(result!.customKeys).toEqual({ OPENAI_API_KEY: "sk-secret" });
      });

      it("uses findFirst instead of findUnique", async () => {
        (prisma.modelProvider.findFirst as any).mockResolvedValue(
          createModelProvider(),
        );

        await repository.findById("mp_test123", "proj_test");

        expect(prisma.modelProvider.findFirst).toHaveBeenCalledWith({
          where: { id: "mp_test123", projectId: "proj_test" },
          include: { scopes: true },
        });
      });
    });

    describe("when provider has null customKeys", () => {
      it("returns null customKeys", async () => {
        const stored = createModelProvider({ customKeys: null });
        (prisma.modelProvider.findFirst as any).mockResolvedValue(stored);

        const result = await repository.findById("mp_test123", "proj_test");

        expect(result!.customKeys).toBeNull();
      });
    });

    describe("when provider not found", () => {
      it("returns null", async () => {
        (prisma.modelProvider.findFirst as any).mockResolvedValue(null);

        const result = await repository.findById("mp_test123", "proj_test");

        expect(result).toBeNull();
      });
    });
  });

  describe("findByProvider()", () => {
    describe("when provider exists with encrypted keys", () => {
      it("decrypts customKeys before returning", async () => {
        const encrypted = (repository as any).encryptCustomKeys({
          ANTHROPIC_API_KEY: "sk-ant-secret",
        });
        const stored = createModelProvider({
          provider: "anthropic",
          customKeys: encrypted,
        });
        (prisma.modelProvider.findFirst as any).mockResolvedValue(stored);

        const result = await repository.findByProvider(
          "anthropic",
          "proj_test",
        );

        expect(result!.customKeys).toEqual({
          ANTHROPIC_API_KEY: "sk-ant-secret",
        });
      });
    });
  });

  describe("findAll()", () => {
    describe("when multiple providers exist", () => {
      it("decrypts customKeys for each provider", async () => {
        const encrypted1 = (repository as any).encryptCustomKeys({
          OPENAI_API_KEY: "sk-openai",
        });
        const encrypted2 = (repository as any).encryptCustomKeys({
          ANTHROPIC_API_KEY: "sk-anthropic",
        });

        const stored = [
          createModelProvider({
            id: "mp_1",
            provider: "openai",
            customKeys: encrypted1,
          }),
          createModelProvider({
            id: "mp_2",
            provider: "anthropic",
            customKeys: encrypted2,
          }),
          createModelProvider({
            id: "mp_3",
            provider: "google",
            customKeys: null,
          }),
        ];
        (prisma.modelProvider.findMany as any).mockResolvedValue(stored);

        const results = await repository.findAll("proj_test");

        expect(results[0]!.customKeys).toEqual({ OPENAI_API_KEY: "sk-openai" });
        expect(results[1]!.customKeys).toEqual({
          ANTHROPIC_API_KEY: "sk-anthropic",
        });
        expect(results[2]!.customKeys).toBeNull();
      });
    });
  });

  describe("findAllAccessibleForProject()", () => {
    // Gates the multi-scope access resolver: a credential is visible
    // whenever its ModelProviderScope set intersects the project's
    // membership tuple (project, team, org). Unlike iter 107/108 we
    // NO LONGER dedup at the repository layer — same-provider collisions
    // are legitimate data (multi-instance). The consuming service picks
    // the narrowest scope for legacy `Record<provider, …>` callers.
    const projectId = "proj_test";
    const teamId = "team_alpha";
    const orgId = "org_acme";

    const projectRow = {
      id: projectId,
      teamId,
      team: { organizationId: orgId },
    };

    describe("when the project has rows at every scope level", () => {
      it("returns every accessible row without deduplication", async () => {
        (prisma.project.findUnique as any).mockResolvedValue(projectRow);

        const orgOpenAI = createModelProvider({
          id: "mp_org_openai",
          provider: "openai",
          projectId: "proj_sibling",
          scopes: [createScope("ORGANIZATION", orgId, "mp_org_openai")],
        });
        const teamOpenAI = createModelProvider({
          id: "mp_team_openai",
          provider: "openai",
          projectId: "proj_sibling2",
          scopes: [createScope("TEAM", teamId, "mp_team_openai")],
        });
        const projectOpenAI = createModelProvider({
          id: "mp_project_openai",
          provider: "openai",
          projectId,
          scopes: [createScope("PROJECT", projectId, "mp_project_openai")],
        });
        const teamAnthropic = createModelProvider({
          id: "mp_team_anthropic",
          provider: "anthropic",
          projectId: "proj_sibling",
          scopes: [createScope("TEAM", teamId, "mp_team_anthropic")],
        });

        (prisma.modelProvider.findMany as any).mockResolvedValue([
          orgOpenAI,
          teamOpenAI,
          projectOpenAI,
          teamAnthropic,
        ]);

        const results = await repository.findAllAccessibleForProject(projectId);

        expect(results).toHaveLength(4);
        const ids = results.map((r) => r.id).sort();
        expect(ids).toEqual(
          [
            "mp_org_openai",
            "mp_project_openai",
            "mp_team_anthropic",
            "mp_team_openai",
          ].sort(),
        );
        // Each returned row carries its scope set — the repo never
        // collapses them.
        const openaiRows = results.filter((r) => r.provider === "openai");
        expect(openaiRows.map((r) => r.scopes[0]!.scopeType).sort()).toEqual([
          "ORGANIZATION",
          "PROJECT",
          "TEAM",
        ]);
      });
    });

    describe("when only an ORGANIZATION row exists", () => {
      it("the project inherits the ORGANIZATION row", async () => {
        (prisma.project.findUnique as any).mockResolvedValue(projectRow);

        const orgOpenAI = createModelProvider({
          id: "mp_org_openai",
          provider: "openai",
          projectId: "proj_sibling",
          scopes: [createScope("ORGANIZATION", orgId, "mp_org_openai")],
        });
        (prisma.modelProvider.findMany as any).mockResolvedValue([orgOpenAI]);

        const results = await repository.findAllAccessibleForProject(projectId);

        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe("mp_org_openai");
        expect(results[0]!.scopes[0]!.scopeType).toBe("ORGANIZATION");
      });
    });

    describe("when the project does not exist", () => {
      it("returns an empty array without querying modelProvider", async () => {
        (prisma.project.findUnique as any).mockResolvedValue(null);

        const results = await repository.findAllAccessibleForProject(
          "proj_missing",
        );

        expect(results).toEqual([]);
        expect(prisma.modelProvider.findMany).not.toHaveBeenCalled();
      });
    });

    describe("when a TEAM row and PROJECT row coexist for the same provider", () => {
      it("returns both — repo no longer dedupes, service layer picks winner", async () => {
        (prisma.project.findUnique as any).mockResolvedValue(projectRow);

        const teamOpenAI = createModelProvider({
          id: "mp_team_openai",
          provider: "openai",
          projectId: "proj_sibling",
          scopes: [createScope("TEAM", teamId, "mp_team_openai")],
        });
        const projectOpenAI = createModelProvider({
          id: "mp_project_openai",
          provider: "openai",
          projectId,
          scopes: [createScope("PROJECT", projectId, "mp_project_openai")],
        });
        (prisma.modelProvider.findMany as any).mockResolvedValue([
          teamOpenAI,
          projectOpenAI,
        ]);

        const results = await repository.findAllAccessibleForProject(projectId);

        expect(results).toHaveLength(2);
        expect(results.map((r) => r.id).sort()).toEqual([
          "mp_project_openai",
          "mp_team_openai",
        ]);
      });
    });

    describe("when the query filters via the ModelProviderScope join", () => {
      it("uses { scopes: { some: { OR: [...] } } } with all three scope predicates", async () => {
        (prisma.project.findUnique as any).mockResolvedValue(projectRow);
        (prisma.modelProvider.findMany as any).mockResolvedValue([]);

        await repository.findAllAccessibleForProject(projectId);

        const findManyCall = (prisma.modelProvider.findMany as any).mock
          .calls[0][0];
        expect(findManyCall.where.scopes.some.OR).toEqual(
          expect.arrayContaining([
            { scopeType: "PROJECT", scopeId: projectId },
            { scopeType: "TEAM", scopeId: teamId },
            { scopeType: "ORGANIZATION", scopeId: orgId },
          ]),
        );
        expect(findManyCall.include).toEqual({ scopes: true });
      });
    });
  });

  describe("create()", () => {
    describe("when customKeys are provided", () => {
      it("encrypts customKeys before storing", async () => {
        const keys = { OPENAI_API_KEY: "sk-secret" };
        (prisma.modelProvider.create as any).mockResolvedValue(
          createModelProvider({ customKeys: "encrypted" }),
        );

        await repository.create({
          projectId: "proj_test",
          name: "OpenAI",
          provider: "openai",
          enabled: true,
          customKeys: keys,
        });

        const createCall = (prisma.modelProvider.create as any).mock.calls[0][0];
        const storedCustomKeys = createCall.data.customKeys;

        // The stored value must be an encrypted string, not the original object
        expect(typeof storedCustomKeys).toBe("string");
        expect(storedCustomKeys).toContain(":");
      });
    });

    describe("when customKeys are null", () => {
      it("stores null without encryption", async () => {
        (prisma.modelProvider.create as any).mockResolvedValue(
          createModelProvider(),
        );

        await repository.create({
          projectId: "proj_test",
          name: "OpenAI",
          provider: "openai",
          enabled: true,
          customKeys: null,
        });

        const createCall = (prisma.modelProvider.create as any).mock.calls[0][0];
        // null or undefined should pass through
        expect(createCall.data.customKeys).toBeUndefined();
      });
    });
  });

  describe("update()", () => {
    describe("when customKeys are provided", () => {
      it("encrypts customKeys before storing", async () => {
        const keys = { OPENAI_API_KEY: "sk-new-secret" };
        (prisma.modelProvider.update as any).mockResolvedValue(
          createModelProvider({ customKeys: "encrypted" }),
        );

        await repository.update("mp_test123", "proj_test", {
          customKeys: keys,
        });

        const updateCall = (prisma.modelProvider.update as any).mock.calls[0][0];
        const storedCustomKeys = updateCall.data.customKeys;

        expect(typeof storedCustomKeys).toBe("string");
        expect(storedCustomKeys).toContain(":");
      });
    });

    describe("when customKeys are not provided", () => {
      it("does not include customKeys in update", async () => {
        (prisma.modelProvider.update as any).mockResolvedValue(
          createModelProvider(),
        );

        await repository.update("mp_test123", "proj_test", {
          enabled: false,
        });

        const updateCall = (prisma.modelProvider.update as any).mock.calls[0][0];
        expect(updateCall.data.customKeys).toBeUndefined();
      });
    });
  });
});
