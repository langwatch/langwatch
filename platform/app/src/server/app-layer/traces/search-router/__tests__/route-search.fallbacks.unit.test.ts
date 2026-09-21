/**
 * The router with no classifier, and with a route the caller already knows:
 * the model decides and builds, a model that cannot be reached searches the
 * phrase and says so, and a named route skips the classifier.
 *
 * Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
 */
import { describe, expect, it, vi } from "vitest";
import { createSearchRouter } from "../route-search";
import { answering, deps, input, NoModel, RANGE } from "./harness";

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
        isLangyAvailable: true,
        isInstantEvalAvailable: true,
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
        isModelUnavailable: true,
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
        isModelUnavailable: false,
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

describe("given the caller names the route", () => {
  describe("when the text is submitted again", () => {
    /** @scenario "A search the page routed once is not classified again" */
    it("builds that route without asking the classifier", async () => {
      const classifier = answering("filter");
      const d = deps({ classifier });
      const result = await createSearchRouter(d).route(
        input({ text: "annoyed users", forceKind: "instant_eval" }),
      );
      expect(classifier.classify).not.toHaveBeenCalled();
      expect(d.routeWithModel).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        kind: "instant_eval",
        decidedBy: "caller",
      });
    });
  });
});
