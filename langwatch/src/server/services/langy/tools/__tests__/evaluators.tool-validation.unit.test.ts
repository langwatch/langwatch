import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/server/evaluations/evaluators.generated", () => ({
  AVAILABLE_EVALUATORS: {
    "ragas/answer_relevancy": {
      name: "Answer Relevancy",
      description: "Checks answer relevancy",
      category: "RAG",
      isGuardrail: false,
      requiredFields: ["question", "answer"],
      optionalFields: [],
      result: {},
      docsUrl: "https://docs",
    },
  },
}));

vi.mock("~/server/evaluations/getEvaluator", () => ({
  getEvaluatorDefaultSettings: vi.fn(() => ({})),
  getEvaluatorDefinitions: vi.fn(() => ({})),
}));

import {
  LANGY_TOOL_OUTPUT_INVALID_CODE,
  langyToolErrorEnvelope,
} from "../../defineLangyTool";
import {
  makeGetEvaluatorDetails,
  makeListEvaluators,
  makeProposeAddEvaluatorToWorkbench,
  makeProposeCreateEvaluator,
  makeProposeDeleteEvaluator,
  makeProposeUpdateEvaluator,
} from "../evaluators";
import { ConversationToolIdSet } from "../../toolIdValidator";
import type { LangyToolContext } from "../types";

function makeCtx(opts: {
  prismaLike?: Record<string, unknown>;
  evaluatorServiceLike?: Record<string, unknown>;
  seenIds?: ConversationToolIdSet;
} = {}): LangyToolContext {
  return {
    projectId: "project-1",
    seenIds: opts.seenIds ?? new ConversationToolIdSet(),
    evaluatorService:
      (opts.evaluatorServiceLike ??
        {}) as unknown as LangyToolContext["evaluatorService"],
    promptService: {} as LangyToolContext["promptService"],
    prisma:
      (opts.prismaLike ?? {}) as unknown as LangyToolContext["prisma"],
  };
}

function invokeTool(toolDef: unknown, input: unknown): Promise<unknown> {
  const exec = (toolDef as { execute: (i: unknown) => Promise<unknown> })
    .execute;
  return exec(input);
}

function expectInvalidEnvelope(result: unknown) {
  expect(langyToolErrorEnvelope.safeParse(result).success).toBe(true);
  expect((result as { error: { code: string } }).error.code).toBe(
    LANGY_TOOL_OUTPUT_INVALID_CODE,
  );
}

describe("list_evaluators tool-output validation", () => {
  describe("when evaluatorService returns a project evaluator with non-string id", () => {
    it("returns the tool_output_invalid envelope", async () => {
      const evaluatorServiceLike = {
        getAllWithFields: vi.fn().mockResolvedValueOnce([
          {
            id: 99,
            slug: "e-1",
            name: "Eval 1",
            type: "custom",
            fields: [{ identifier: "f1" }],
          },
        ]),
      };
      const toolDef = makeListEvaluators(makeCtx({ evaluatorServiceLike }));
      const result = await invokeTool(toolDef, { scope: "project" });

      expectInvalidEnvelope(result);
    });
  });

  describe("when scope is built_in and the catalog has a well-formed entry", () => {
    it("returns the parsed items array", async () => {
      const toolDef = makeListEvaluators(makeCtx());
      const result = (await invokeTool(toolDef, { scope: "built_in" })) as {
        items: Array<{ source: string }>;
      };

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items[0]?.source).toBe("built_in");
    });
  });
});

describe("get_evaluator_details tool-output validation", () => {
  describe("when neither slug nor evaluatorType is provided", () => {
    it("returns the error variant", async () => {
      const toolDef = makeGetEvaluatorDetails(makeCtx());
      const result = (await invokeTool(toolDef, {})) as { error?: string };

      expect(result.error).toContain("Provide either");
    });
  });

  describe("when looking up a built-in evaluator that doesn't exist", () => {
    it("returns the error variant", async () => {
      const toolDef = makeGetEvaluatorDetails(makeCtx());
      const result = (await invokeTool(toolDef, {
        evaluatorType: "ragas/does_not_exist",
      })) as { error?: string };

      expect(result.error).toContain("No built-in evaluator");
    });
  });
});

describe("propose_create_evaluator tool-output validation", () => {
  describe("when the evaluator type was not surfaced", () => {
    it("returns the error variant", async () => {
      const toolDef = makeProposeCreateEvaluator(makeCtx());
      const result = (await invokeTool(toolDef, {
        name: "New",
        evaluatorType: "ragas/answer_relevancy",
        rationale: "r",
      })) as { error?: string };

      expect(result.error).toContain("not surfaced");
    });
  });

  describe("when the evaluator type was surfaced", () => {
    it("returns the proposal envelope", async () => {
      const seen = new ConversationToolIdSet();
      seen.record("evaluator_type", "ragas/answer_relevancy");
      const prismaLike = {
        project: {
          findUnique: vi.fn().mockResolvedValueOnce({
            defaultModel: "openai/gpt-5-mini",
            embeddingsModel: "openai/text-embedding-3-small",
          }),
        },
      };
      const toolDef = makeProposeCreateEvaluator(
        makeCtx({ prismaLike, seenIds: seen }),
      );
      const result = (await invokeTool(toolDef, {
        name: "New",
        evaluatorType: "ragas/answer_relevancy",
        rationale: "r",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("evaluators.create");
    });
  });
});

describe("propose_update_evaluator tool-output validation", () => {
  describe("when the slug was not surfaced", () => {
    it("returns the error variant", async () => {
      const toolDef = makeProposeUpdateEvaluator(makeCtx());
      const result = (await invokeTool(toolDef, {
        slug: "unsurfaced",
        rationale: "r",
      })) as { error?: string };

      expect(result.error).toContain("not surfaced");
    });
  });

  describe("when the slug was surfaced and the evaluator exists", () => {
    it("returns the proposal envelope", async () => {
      const seen = new ConversationToolIdSet();
      seen.record("evaluator_slug", "e-1");
      const evaluatorServiceLike = {
        getBySlug: vi.fn().mockResolvedValueOnce({
          id: "ev-id-1",
          name: "Eval 1",
          slug: "e-1",
          config: { evaluatorType: "custom", settings: {} },
        }),
      };
      const toolDef = makeProposeUpdateEvaluator(
        makeCtx({ evaluatorServiceLike, seenIds: seen }),
      );
      const result = (await invokeTool(toolDef, {
        slug: "e-1",
        name: "Renamed",
        rationale: "r",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("evaluators.update");
    });
  });
});

describe("propose_delete_evaluator tool-output validation", () => {
  describe("when the slug was surfaced and the evaluator exists", () => {
    it("returns the proposal envelope with destructive: true", async () => {
      const seen = new ConversationToolIdSet();
      seen.record("evaluator_slug", "e-1");
      const evaluatorServiceLike = {
        getBySlug: vi.fn().mockResolvedValueOnce({
          id: "ev-id-1",
          name: "Eval 1",
          slug: "e-1",
        }),
      };
      const toolDef = makeProposeDeleteEvaluator(
        makeCtx({ evaluatorServiceLike, seenIds: seen }),
      );
      const result = (await invokeTool(toolDef, {
        slug: "e-1",
        rationale: "r",
      })) as { langyProposal: true; destructive: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.destructive).toBe(true);
      expect(result.kind).toBe("evaluators.delete");
    });
  });
});

describe("propose_add_evaluator_to_workbench tool-output validation", () => {
  describe("when the slug was surfaced and the evaluator exists", () => {
    it("returns the proposal envelope", async () => {
      const seen = new ConversationToolIdSet();
      seen.record("evaluator_slug", "e-1");
      const evaluatorServiceLike = {
        getBySlug: vi.fn().mockResolvedValueOnce({
          id: "ev-id-1",
          name: "Eval 1",
          slug: "e-1",
          config: { evaluatorType: "ragas/answer_relevancy" },
        }),
        enrichWithFields: vi.fn().mockImplementation(async (e: unknown) => ({
          ...(e as Record<string, unknown>),
          fields: [],
        })),
      };
      const toolDef = makeProposeAddEvaluatorToWorkbench(
        makeCtx({ evaluatorServiceLike, seenIds: seen }),
      );
      const result = (await invokeTool(toolDef, {
        slug: "e-1",
        rationale: "r",
      })) as { langyProposal: true; kind: string };

      expect(result.langyProposal).toBe(true);
      expect(result.kind).toBe("workbench.addEvaluator");
    });
  });
});
