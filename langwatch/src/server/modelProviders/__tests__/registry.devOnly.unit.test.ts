import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, Project } from "@prisma/client";

// `env.IS_SAAS` is computed once at module load from a t3-env config, so
// `vi.stubEnv("IS_SAAS", ...)` after import wouldn't reach it. Mock the
// accessor so the auto-enable short-circuit test can put the service in
// SaaS mode (where a non-devOnly provider WOULD auto-enable from an env
// key) and prove the devOnly provider still doesn't.
const envMock = vi.hoisted(() => ({ IS_SAAS: false }));
vi.mock("~/env.mjs", () => ({
  get env() {
    return envMock;
  },
}));
import { isProviderVisible, modelProviders } from "../registry";
import { ModelProviderService } from "../modelProvider.service";
import type {
  ModelProviderRepository,
  ModelProviderWithScopes,
} from "../modelProvider.repository";

describe("devOnly provider visibility gate", () => {
  describe("isProviderVisible", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    describe("given a devOnly provider (langwatch_noai)", () => {
      describe("when NODE_ENV is production", () => {
        /** @scenario fake provider is hidden in production */
        it("hides the provider", () => {
          vi.stubEnv("NODE_ENV", "production");

          expect(isProviderVisible(modelProviders.langwatch_noai)).toBe(false);
        });
      });

      describe("when NODE_ENV is development", () => {
        it("shows the provider", () => {
          vi.stubEnv("NODE_ENV", "development");

          expect(isProviderVisible(modelProviders.langwatch_noai)).toBe(true);
        });
      });
    });

    describe("given a non-devOnly provider (openai)", () => {
      describe("when NODE_ENV is production", () => {
        it("shows the provider", () => {
          vi.stubEnv("NODE_ENV", "production");

          expect(isProviderVisible(modelProviders.openai)).toBe(true);
        });
      });
    });
  });
});

const makeProject = (): Project =>
  ({
    id: "project-1",
    teamId: "team-1",
    createdAt: new Date("2026-06-05"),
  }) as unknown as Project;

const makeSavedNoaiRow = (): ModelProviderWithScopes =>
  ({
    id: "mp-noai",
    name: "LangWatch NoAI",
    provider: "langwatch_noai",
    enabled: true,
    // Custom keys make shouldKeepModelProvider keep it on customization
    // grounds — the visibility gate must override that.
    customKeys: { LANGWATCH_NOAI_BASE_URL: "http://localhost:9999" },
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: [],
    scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
  }) as unknown as ModelProviderWithScopes;

const buildService = (savedRows: ModelProviderWithScopes[]) => {
  const prisma = {
    project: {
      findUnique: vi.fn().mockResolvedValue(makeProject()),
    },
  } as unknown as PrismaClient;

  const repository = {
    findAllAccessibleForProject: vi.fn().mockResolvedValue(savedRows),
  } as unknown as ModelProviderRepository;

  return new ModelProviderService(prisma, repository);
};

describe("getProjectModelProviders devOnly filtering", () => {
  beforeEach(() => {
    // SaaS mode + an env key present would otherwise be the only way a
    // default provider auto-enables; we keep it off so the only signal
    // under test is visibility.
    envMock.IS_SAAS = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    envMock.IS_SAAS = false;
  });

  describe("given no saved rows", () => {
    describe("when NODE_ENV is production", () => {
      it("excludes langwatch_noai from the default providers", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const service = buildService([]);

        const providers = await service.getProjectModelProviders("project-1");

        expect(providers.langwatch_noai).toBeUndefined();
        expect(providers.openai).toBeDefined();
      });
    });

    describe("when NODE_ENV is development", () => {
      it("includes langwatch_noai in the default providers", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const service = buildService([]);

        const providers = await service.getProjectModelProviders("project-1");

        expect(providers.langwatch_noai).toBeDefined();
      });
    });
  });

  describe("given a saved langwatch_noai row seeded in dev", () => {
    describe("when NODE_ENV is production", () => {
      it("drops the saved row", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const service = buildService([makeSavedNoaiRow()]);

        const providers = await service.getProjectModelProviders("project-1");

        expect(providers.langwatch_noai).toBeUndefined();
      });
    });

    describe("when NODE_ENV is development", () => {
      it("keeps the saved row", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const service = buildService([makeSavedNoaiRow()]);

        const providers = await service.getProjectModelProviders("project-1");

        expect(providers.langwatch_noai).toBeDefined();
        expect(providers.langwatch_noai?.id).toBe("mp-noai");
      });
    });
  });
});

describe("updateModelProvider devOnly rejection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given a devOnly provider in production", () => {
    describe("when a caller tries to persist it", () => {
      it("rejects with an invalid-provider error", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const service = buildService([]);

        await expect(
          service.updateModelProvider({
            projectId: "project-1",
            provider: "langwatch_noai",
            enabled: true,
          }),
        ).rejects.toThrow("Invalid provider");
      });
    });
  });
});

describe("devOnly env-key auto-enable short-circuit", () => {
  beforeEach(() => {
    // Development so the provider is visible; SaaS + env key present so a
    // non-devOnly provider in its position WOULD auto-enable.
    vi.stubEnv("NODE_ENV", "development");
    envMock.IS_SAAS = true;
    vi.stubEnv("LANGWATCH_NOAI_API_KEY", "anything");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    envMock.IS_SAAS = false;
  });

  describe("given a stray LANGWATCH_NOAI_API_KEY in the host env", () => {
    describe("when default providers are built", () => {
      it("never auto-enables the fake provider from the env key", async () => {
        const service = buildService([]);

        const providers = await service.getProjectModelProviders("project-1");

        expect(providers.langwatch_noai?.enabled).toBe(false);
      });
    });
  });
});
