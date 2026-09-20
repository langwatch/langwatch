/**
 * @vitest-environment node
 *
 * `tracesV2.routeSearch` through the real tRPC router, on a deployment with
 * the null classifier: the FAST model both decides and builds, and when no
 * model is configured the words are searched as a phrase with the flag the
 * client turns into the "connect a model" primer. Session and RBAC run
 * against the real test database; the model is a stub.
 *
 * Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
 */
import { MockLanguageModelV3 } from "ai/test";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getTestUser } from "../../../../utils/testUtils";
import { ModelNotConfiguredError } from "../../../modelProviders/modelNotConfiguredError";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

vi.mock("~/server/app-layer/instant-evals/classifier", () => ({
  isInstantEvalClassifierConfigured: () => false,
  getInstantEvalClassifier: () => {
    throw new Error("the null deployment never builds a classifier");
  },
}));

// The release flag is off by default; these cases state it instead.
const mockInstantEvalsReleased = vi.fn(async () => true);
vi.mock("~/server/app-layer/instant-evals/access", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/instant-evals/access")
  >()),
  instantEvalsReleased: () => mockInstantEvalsReleased(),
}));

const mockGetVercelAIModel = vi.fn();
/** The unmocked resolver, for the case that runs the real model resolution. */
const real = vi.hoisted(() => ({
  getVercelAIModel: null as ((...args: unknown[]) => unknown) | null,
}));
vi.mock("~/server/modelProviders/utils", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/server/modelProviders/utils")>();
  real.getVercelAIModel = original.getVercelAIModel as (
    ...args: unknown[]
  ) => unknown;
  return {
    ...original,
    getVercelAIModel: (...args: unknown[]) => mockGetVercelAIModel(...args),
  };
});

const PROJECT_ID = "test-project-id";
const RANGE = { from: Date.now() - 3_600_000, to: Date.now() };

/** A model that answers every structured call with the given object. */
function modelAnswering(object: unknown): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(object) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("tracesV2.routeSearch", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const user = await getTestUser();
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: user.id }, expires: "1" },
      }),
    );
  });

  beforeEach(() => {
    mockGetVercelAIModel.mockReset();
    mockInstantEvalsReleased.mockReset();
    mockInstantEvalsReleased.mockResolvedValue(true);
  });

  describe("given only field:value terms", () => {
    it("answers the filter as typed without touching the model", async () => {
      const result = await caller.tracesV2.routeSearch({
        projectId: PROJECT_ID,
        text: "status:error AND model:gpt-4o",
        timeRange: RANGE,
      });
      expect(result).toEqual({
        kind: "filter",
        query: "status:error AND model:gpt-4o",
        decidedBy: "fallback",
      });
      expect(mockGetVercelAIModel).not.toHaveBeenCalled();
    });
  });

  describe("given no classifier and a model that answers a filter", () => {
    /** @scenario "Without the classifier the model decides and builds in one call" */
    it("returns the model's filter merged with the explicit terms", async () => {
      mockGetVercelAIModel.mockResolvedValue(
        modelAnswering({ route: "filter", query: "status:error" }),
      );
      const result = await caller.tracesV2.routeSearch({
        projectId: PROJECT_ID,
        text: "failing calls model:gpt-4o",
        timeRange: RANGE,
        activeQuery: "",
        lensId: "all-traces",
      });
      expect(result).toEqual({
        kind: "filter",
        query: "model:gpt-4o AND status:error",
        decidedBy: "model",
      });
      expect(mockGetVercelAIModel).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          featureKey: "traces.ai_search",
        }),
      );
    });
  });

  describe("given no classifier and a model that answers a judgement", () => {
    it("returns the judge question with the target from the lens", async () => {
      mockGetVercelAIModel.mockResolvedValue(
        modelAnswering({
          route: "instant_eval",
          instructions: "Does the user sound annoyed?",
          yes: "Complains or repeats a request",
          no: "Stays neutral",
        }),
      );
      const result = await caller.tracesV2.routeSearch({
        projectId: PROJECT_ID,
        text: "annoyed users",
        timeRange: RANGE,
        lensId: "conversations",
      });
      expect(result).toEqual({
        kind: "instant_eval",
        question: {
          instructions: "Does the user sound annoyed?",
          criteria: ["Complains or repeats a request", "Stays neutral"],
        },
        target: "threads",
        otherQuery: "",
        fallbackQuery: '"annoyed users"',
        decidedBy: "model",
      });
    });
  });

  describe("given Instant Evals are not released and a model that answers a judgement", () => {
    /** @scenario "With Instant Evals not released for the project the router does not offer the judgement route" */
    it("searches the phrase and tells the model the route is closed", async () => {
      mockInstantEvalsReleased.mockResolvedValue(false);
      const model = modelAnswering({
        route: "instant_eval",
        instructions: "Does the user sound annoyed?",
        yes: "Complains or repeats a request",
        no: "Stays neutral",
      });
      mockGetVercelAIModel.mockResolvedValue(model);
      const result = await caller.tracesV2.routeSearch({
        projectId: PROJECT_ID,
        text: "annoyed users",
        timeRange: RANGE,
      });
      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "model",
        modelUnavailable: false,
      });
      expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
        "`instant_eval` is not available on this project",
      );
    });
  });

  describe("given no classifier and no model configured", () => {
    /** @scenario "Without a classifier or a model the words are searched as a phrase" */
    it("searches the phrase and flags the missing model, without an error", async () => {
      mockGetVercelAIModel.mockRejectedValue(
        new ModelNotConfiguredError(
          "traces.ai_search",
          "FAST",
          "Trace search",
          PROJECT_ID,
        ),
      );
      const result = await caller.tracesV2.routeSearch({
        projectId: PROJECT_ID,
        text: "annoyed users status:error",
        timeRange: RANGE,
      });
      expect(result).toEqual({
        kind: "free_text",
        query: 'status:error AND "annoyed users"',
        decidedBy: "fallback",
        modelUnavailable: true,
        fellBackFrom: "routing",
      });
    });
  });

  describe("given no classifier and a FAST model whose provider is disabled", () => {
    let configId: string | undefined;
    let providerId: string | undefined;

    beforeAll(async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: PROJECT_ID },
        include: { team: true },
      });
      const organizationId = project.team.organizationId;
      const provider = await prisma.modelProvider.create({
        data: {
          name: `DeepSeek ${nanoid(6)}`,
          provider: "deepseek",
          enabled: false,
          organizationId,
          scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
        },
        select: { id: true },
      });
      providerId = provider.id;
      const config = await prisma.modelDefaultConfig.create({
        data: {
          config: {
            DEFAULT: "deepseek/deepseek-chat",
            FAST: "deepseek/deepseek-chat",
          },
          organizationId,
          scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
        },
        select: { id: true },
      });
      configId = config.id;
    });

    afterAll(async () => {
      if (configId) {
        await prisma.modelDefaultConfig.delete({ where: { id: configId } });
      }
      if (providerId) {
        await prisma.modelProvider.delete({ where: { id: providerId } });
      }
    });

    /** @scenario "A model whose provider is disabled counts as no model" */
    it("searches the phrase and flags the missing model, through the real model resolution", async () => {
      mockGetVercelAIModel.mockImplementation((...args: unknown[]) =>
        real.getVercelAIModel?.(...args),
      );
      const result = await caller.tracesV2.routeSearch({
        projectId: PROJECT_ID,
        text: "annoyed users",
        timeRange: RANGE,
      });
      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "fallback",
        modelUnavailable: true,
        fellBackFrom: "routing",
      });
    });
  });

  describe("given the model fails on every attempt", () => {
    /** @scenario "A model failure is a phrase search, not an error" */
    it("searches the phrase without flagging a missing model", async () => {
      mockGetVercelAIModel.mockResolvedValue(
        new MockLanguageModelV3({
          doGenerate: async () => {
            throw new Error("502 from the provider");
          },
        }),
      );
      const result = await caller.tracesV2.routeSearch({
        projectId: PROJECT_ID,
        text: "annoyed users",
        timeRange: RANGE,
      });
      expect(result).toMatchObject({
        kind: "free_text",
        query: '"annoyed users"',
        modelUnavailable: false,
        fellBackFrom: "routing",
      });
    });
  });
});
