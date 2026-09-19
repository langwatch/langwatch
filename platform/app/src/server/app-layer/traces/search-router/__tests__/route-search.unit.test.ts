/**
 * The search router's decision table with a stub classifier and stub
 * builders: the four routes, the two fallbacks (no classifier, no model), the
 * model's empty-query escape hatch, and the merge of explicit terms.
 *
 * Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, type Mock, vi } from "vitest";
import type {
  InstantEvalClassifyRequest,
  InstantEvalJudgement,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import {
  buildRouteContext,
  buildRouteQuestion,
  createSearchRouter,
  type RouteSearchInput,
  type SearchRouteKind,
  type SearchRouterDeps,
} from "../route-search";

const RANGE = { from: 1_000_000, to: 1_000_000 + 24 * 3_600_000 };

const input = (
  overrides: Partial<RouteSearchInput> = {},
): RouteSearchInput => ({
  projectId: "project-1",
  text: "annoyed users",
  timeRange: RANGE,
  activeQuery: "",
  ...overrides,
});

function answering(label: SearchRouteKind | null) {
  const classify = vi.fn(
    async (
      _request: InstantEvalClassifyRequest,
    ): Promise<InstantEvalJudgement> =>
      label
        ? {
            verdicts: [{ questionId: "route", label }],
            inputTokens: 120,
            isTextTruncated: false,
          }
        : {
            verdicts: [],
            skippedReason: "classifier_rate_limited",
            inputTokens: 0,
            isTextTruncated: false,
          },
  );
  return { classify };
}

class NoModel extends HandledError {
  declare readonly code: "model_not_configured";
  constructor() {
    super("model_not_configured", "No model configured.", { httpStatus: 400 });
  }
}

function deps(overrides: Partial<SearchRouterDeps> = {}): SearchRouterDeps & {
  recordDecision: Mock<SearchRouterDeps["recordDecision"]>;
} {
  return {
    classifier: null,
    buildFilter: vi.fn(async () => ({
      ok: true as const,
      kind: "apply_query" as const,
      query: "status:error",
    })),
    buildQuestion: vi.fn(async () => ({
      kind: "question" as const,
      instructions: "Does the user sound annoyed?",
      criteria: ["Complains or repeats", "Stays neutral"] as [string, string],
    })),
    routeWithModel: vi.fn(async () => ({ route: "free_text" as const })),
    listKnownSignals: vi.fn(async () => ({
      evaluators: ["ragas/faithfulness"],
      events: ["thumbs_up_down"],
    })),
    recordDecision: vi.fn<SearchRouterDeps["recordDecision"]>(),
    ...overrides,
  };
}

describe("given a text with only field:value terms", () => {
  describe("when routed", () => {
    it("answers a filter as typed without asking anyone", async () => {
      const d = deps({ classifier: answering("langy") });
      const result = await createSearchRouter(d).route(
        input({ text: "status:error AND model:gpt-4o" }),
      );
      expect(result).toEqual({
        kind: "filter",
        query: "status:error AND model:gpt-4o",
        decidedBy: "fallback",
      });
      expect(d.classifier?.classify).not.toHaveBeenCalled();
      expect(d.routeWithModel).not.toHaveBeenCalled();
    });
  });
});

describe("given the classifier is configured", () => {
  describe("when it answers filter", () => {
    /** @scenario "A sentence the filter language can express becomes chips" */
    it("builds the filter with the composer's builder and merges the explicit terms", async () => {
      const d = deps({ classifier: answering("filter") });
      const result = await createSearchRouter(d).route(
        input({ text: "errors from gpt-4 service:checkout" }),
      );
      expect(result).toEqual({
        kind: "filter",
        query: "service:checkout AND status:error",
        decidedBy: "classifier",
      });
      expect(d.buildFilter).toHaveBeenCalledWith({
        projectId: "project-1",
        prompt: "errors from gpt-4",
        timeRange: RANGE,
      });
      expect(d.recordDecision).toHaveBeenCalledWith({
        route: "filter",
        decidedBy: "classifier",
      });
    });

    /** @scenario "A filter the model could not write becomes a phrase search" */
    it("falls through to the phrase when the model answers an empty query", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => ({
          ok: true as const,
          kind: "apply_query" as const,
          query: "",
        })),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "fallback",
        modelUnavailable: false,
        fellBackFrom: "filter",
      });
    });

    it("falls through to the phrase when the builder throws, flagging a missing model", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => {
          throw new NoModel();
        }),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toMatchObject({
        kind: "free_text",
        modelUnavailable: true,
        fellBackFrom: "filter",
      });
    });
  });

  describe("when it answers instant_eval", () => {
    /** @scenario "A sentence that needs a judgement becomes an Instant Eval question" */
    it("returns the judge question, the target from the lens and the phrase fallback", async () => {
      const d = deps({ classifier: answering("instant_eval") });
      const result = await createSearchRouter(d).route(
        input({ text: "annoyed users status:error", lensId: "conversations" }),
      );
      expect(result).toEqual({
        kind: "instant_eval",
        question: {
          instructions: "Does the user sound annoyed?",
          criteria: ["Complains or repeats", "Stays neutral"],
        },
        target: "threads",
        otherQuery: "status:error",
        fallbackQuery: 'status:error AND "annoyed users"',
        decidedBy: "classifier",
      });
      expect(d.buildQuestion).toHaveBeenCalledWith({
        projectId: "project-1",
        text: "annoyed users",
        target: "threads",
        known: {
          evaluators: ["ragas/faithfulness"],
          events: ["thumbs_up_down"],
        },
      });
    });

    it("judges traces on every lens but Conversations", async () => {
      const d = deps({ classifier: answering("instant_eval") });
      const result = await createSearchRouter(d).route(
        input({ lensId: "all-traces" }),
      );
      expect(result).toMatchObject({ kind: "instant_eval", target: "traces" });
    });

    /** @scenario "An existing evaluator answers the judgement as a filter" */
    it("returns a filter with the reason when an existing evaluator answers it", async () => {
      const d = deps({
        classifier: answering("instant_eval"),
        buildQuestion: vi.fn(async () => ({
          kind: "filter" as const,
          query: "evaluator:ragas/faithfulness AND evaluatorVerdict:fail",
          reason: "The faithfulness evaluator already flags these.",
        })),
      });
      const result = await createSearchRouter(d).route(
        input({ text: "hallucinated answers" }),
      );
      expect(result).toEqual({
        kind: "filter",
        query: "evaluator:ragas/faithfulness AND evaluatorVerdict:fail",
        explanation: "The faithfulness evaluator already flags these.",
        decidedBy: "classifier",
      });
    });
  });

  describe("when it answers free_text", () => {
    /** @scenario "A literal phrase is searched as one phrase" */
    it("quotes the sentence and merges the explicit terms", async () => {
      const d = deps({ classifier: answering("free_text") });
      const result = await createSearchRouter(d).route(
        input({ text: "cannot connect to database service:api" }),
      );
      expect(result).toEqual({
        kind: "free_text",
        query: 'service:api AND "cannot connect to database"',
        decidedBy: "classifier",
        modelUnavailable: false,
      });
      expect(d.buildFilter).not.toHaveBeenCalled();
      expect(d.routeWithModel).not.toHaveBeenCalled();
    });
  });

  describe("when it answers langy", () => {
    /** @scenario "A question for the assistant goes to Langy with the view attached" */
    it("hands the whole typed text over as the question", async () => {
      const d = deps({ classifier: answering("langy") });
      const result = await createSearchRouter(d).route(
        input({ text: "why did errors spike this morning" }),
      );
      expect(result).toEqual({
        kind: "langy",
        question: "why did errors spike this morning",
        decidedBy: "classifier",
      });
    });

    it("never offers the Langy option when Langy is not available", async () => {
      const classifier = answering("free_text");
      await createSearchRouter(deps({ classifier })).route(
        input({ langyAvailable: false }),
      );
      const request = classifier.classify.mock.calls[0]?.[0];
      const question = request?.questions[0];
      expect(question?.kind).toBe("category");
      expect(
        question?.kind === "category"
          ? question.options.map((option) => option.name)
          : [],
      ).toEqual(["filter", "instant_eval", "free_text"]);
    });
  });

  describe("when it skips or fails", () => {
    it("lets the model decide instead", async () => {
      const d = deps({
        classifier: answering(null),
        routeWithModel: vi.fn(async () => ({
          route: "filter" as const,
          query: "status:error",
        })),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toEqual({
        kind: "filter",
        query: "status:error",
        decidedBy: "model",
      });
    });

    it("survives a classifier that throws", async () => {
      const d = deps({
        classifier: {
          classify: vi.fn(async () => {
            throw new Error("socket hang up");
          }),
        },
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toMatchObject({ kind: "free_text", decidedBy: "model" });
    });
  });

  describe("when the context is built", () => {
    it("carries the sentence, the lens, the window, the fields and the known signals", () => {
      const context = buildRouteContext({
        sentence: "annoyed users",
        explicitQuery: "status:error",
        activeQuery: "model:gpt-4o",
        lensId: "conversations",
        timeRange: RANGE,
        known: {
          evaluators: ["ragas/faithfulness"],
          events: ["thumbs_up_down"],
        },
      });
      expect(context).toContain("Typed sentence: annoyed users");
      expect(context).toContain("Lens: conversations. Time window: 24 hours.");
      expect(context).toContain("Typed alongside it as filters: status:error");
      expect(context).toContain("Search applied before this one: model:gpt-4o");
      expect(context).toContain("status, model, service");
      expect(context).toContain("ragas/faithfulness");
      expect(context).toContain("thumbs_up_down");
    });

    it("asks one category question with the four routes", () => {
      const question = buildRouteQuestion({ langyAvailable: true });
      expect(question.options.map((option) => option.name)).toEqual([
        "filter",
        "instant_eval",
        "free_text",
        "langy",
      ]);
    });
  });
});

describe("given no classifier", () => {
  describe("when the model routes", () => {
    /** @scenario "Without the classifier the model decides and builds in one call" */
    it("uses the model's decision and merges explicit terms into its filter", async () => {
      const d = deps({
        routeWithModel: vi.fn(async () => ({
          route: "filter" as const,
          query: "status:error OR status:warning",
        })),
      });
      const result = await createSearchRouter(d).route(
        input({ text: "failing calls model:gpt-4o" }),
      );
      expect(result).toEqual({
        kind: "filter",
        query: "model:gpt-4o AND (status:error OR status:warning)",
        decidedBy: "model",
      });
      expect(d.routeWithModel).toHaveBeenCalledWith({
        projectId: "project-1",
        text: "failing calls",
        timeRange: RANGE,
        target: "traces",
        known: {
          evaluators: ["ragas/faithfulness"],
          events: ["thumbs_up_down"],
        },
        langyAvailable: true,
      });
    });

    it("returns the model's judge question on instant_eval", async () => {
      const d = deps({
        routeWithModel: vi.fn(async () => ({
          route: "instant_eval" as const,
          instructions: "Is the user annoyed?",
          criteria: ["yes", "no"] as [string, string],
        })),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toMatchObject({
        kind: "instant_eval",
        question: {
          instructions: "Is the user annoyed?",
          criteria: ["yes", "no"],
        },
        fallbackQuery: '"annoyed users"',
        decidedBy: "model",
      });
    });

    it("returns langy on langy", async () => {
      const d = deps({
        routeWithModel: vi.fn(async () => ({ route: "langy" as const })),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toEqual({
        kind: "langy",
        question: "annoyed users",
        decidedBy: "model",
      });
    });
  });

  describe("when there is no model either", () => {
    /** @scenario "Without a classifier or a model the words are searched as a phrase" */
    it("searches the phrase and says a model is missing", async () => {
      const d = deps({
        routeWithModel: vi.fn(async () => {
          throw new NoModel();
        }),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "fallback",
        modelUnavailable: true,
        fellBackFrom: "routing",
      });
    });
  });

  describe("when the model fails", () => {
    /** @scenario "A model failure is a phrase search, not an error" */
    it("searches the phrase without flagging a missing model", async () => {
      const d = deps({
        routeWithModel: vi.fn(async () => {
          throw new Error("502 from the provider");
        }),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "fallback",
        modelUnavailable: false,
        fellBackFrom: "routing",
      });
    });
  });

  describe("when the known signals cannot be listed", () => {
    it("routes without them", async () => {
      const d = deps({
        listKnownSignals: vi.fn(async () => {
          throw new Error("facets down");
        }),
      });
      const result = await createSearchRouter(d).route(input());
      expect(result).toMatchObject({ kind: "free_text" });
      expect(d.routeWithModel).toHaveBeenCalledWith(
        expect.objectContaining({ known: { evaluators: [], events: [] } }),
      );
    });
  });
});
