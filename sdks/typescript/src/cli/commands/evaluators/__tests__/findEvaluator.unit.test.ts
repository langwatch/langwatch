import { describe, expect, it, vi } from "vitest";

import { EvaluatorsApiError } from "@/client-sdk/services/evaluators";
import type { EvaluatorResponse } from "@/client-sdk/services/evaluators";
import { LangWatchHandledError } from "@/internal/api/errors";

import { findEvaluator } from "../findEvaluator";

const handled = (code: string) =>
  new LangWatchHandledError({
    handled: {
      code,
      kind: code,
      message: "boom",
      httpStatus: 404,
      meta: {},
      isHandled: true,
      retryable: false,
      traceId: undefined,
      traceUrl: undefined,
      reasons: undefined,
      suggestions: undefined,
      docUrl: undefined,
    },
    body: { error: code },
    operation: "get evaluator",
    message: "boom",
  });

const evaluator = (overrides: Partial<EvaluatorResponse>) =>
  ({ id: "ev_1", slug: "tone-check", name: "Tone Check", ...overrides }) as EvaluatorResponse;

const makeService = ({
  get,
  rows = [],
}: {
  get: () => Promise<EvaluatorResponse>;
  rows?: EvaluatorResponse[];
}) => {
  const getAll = vi.fn(async () => rows);
  return { service: { get: vi.fn(get), getAll }, getAll };
};

describe("findEvaluator()", () => {
  describe("when the exact lookup succeeds", () => {
    it("returns that evaluator", async () => {
      const found = evaluator({});
      const { service } = makeService({ get: async () => found });

      await expect(findEvaluator({ service, reference: "tone-check" })).resolves.toBe(found);
    });

    it("does not list evaluators", async () => {
      const { service, getAll } = makeService({ get: async () => evaluator({}) });

      await findEvaluator({ service, reference: "tone-check" });

      expect(getAll).not.toHaveBeenCalled();
    });
  });

  describe("when the exact lookup says evaluator_not_found", () => {
    const notFound = async (): Promise<EvaluatorResponse> => {
      throw handled("evaluator_not_found");
    };

    describe("and one evaluator has that display name", () => {
      it("returns it", async () => {
        const match = evaluator({ id: "ev_9", name: "Tone Check" });
        const { service } = makeService({ get: notFound, rows: [match] });

        await expect(findEvaluator({ service, reference: "tone check" })).resolves.toBe(match);
      });
    });

    describe("and two evaluators share that display name", () => {
      it("fails asking for the id", async () => {
        const { service } = makeService({
          get: notFound,
          rows: [
            evaluator({ id: "ev_1", slug: "a", name: "Twin" }),
            evaluator({ id: "ev_2", slug: "b", name: "Twin" }),
          ],
        });

        await expect(findEvaluator({ service, reference: "Twin" })).rejects.toThrow(
          'More than one evaluator is named "Twin" (ev_1, ev_2). Pass the id instead.',
        );
      });
    });

    describe("and nothing matches", () => {
      it("fails pointing at the list command", async () => {
        const { service } = makeService({ get: notFound, rows: [evaluator({})] });

        await expect(findEvaluator({ service, reference: "ghost" })).rejects.toThrow(
          'No evaluator with the id, slug or name "ghost" in this project. List them with `langwatch evaluator list`.',
        );
      });
    });
  });

  describe("when the exact lookup fails with another handled code", () => {
    it("rethrows it unchanged", async () => {
      const error = handled("permission_denied");
      const { service } = makeService({
        get: async () => {
          throw error;
        },
      });

      await expect(findEvaluator({ service, reference: "x" })).rejects.toBe(error);
    });

    it("does not list evaluators", async () => {
      const { service, getAll } = makeService({
        get: async () => {
          throw handled("permission_denied");
        },
      });

      await findEvaluator({ service, reference: "x" }).catch(() => undefined);

      expect(getAll).not.toHaveBeenCalled();
    });
  });

  describe("when the exact lookup fails with a plain API error", () => {
    it("rethrows it unchanged without listing evaluators", async () => {
      const error = new EvaluatorsApiError("Network error", "fetch evaluator");
      const { service, getAll } = makeService({
        get: async () => {
          throw error;
        },
      });

      await expect(findEvaluator({ service, reference: "x" })).rejects.toBe(error);
      expect(getAll).not.toHaveBeenCalled();
    });
  });
});
