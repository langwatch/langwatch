import { describe, expect, it, vi } from "vitest";

import { EvaluatorsApiError } from "@/client-sdk/services/evaluators";
import type { EvaluatorResponse } from "@/client-sdk/services/evaluators";

import { findEvaluator, refusalFromReference } from "../findEvaluator";
import { handledError as handled } from "./handledErrorFixture";

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
      /** @scenario Get evaluator by a display name two evaluators share */
      it("fails asking for the id", async () => {
        const { service } = makeService({
          get: notFound,
          rows: [
            evaluator({ id: "ev_1", slug: "a", name: "Twin" }),
            evaluator({ id: "ev_2", slug: "b", name: "Twin" }),
          ],
        });

        const refusal = await findEvaluator({ service, reference: "Twin" }).catch(
          refusalFromReference,
        );

        expect(refusal).toMatchObject({
          code: "validation_error",
          message: expect.stringContaining("(ev_1, ev_2). Pass the id instead."),
        });
      });
    });

    describe("and nothing matches", () => {
      /** @scenario Get evaluator by a name nothing matches */
      it("fails pointing at the list command", async () => {
        const { service } = makeService({ get: notFound, rows: [evaluator({})] });

        const refusal = await findEvaluator({ service, reference: "ghost" }).catch(
          refusalFromReference,
        );

        expect(refusal).toMatchObject({
          code: "evaluator_not_found",
          httpStatus: 404,
          message: expect.stringContaining("List them with `langwatch evaluator list`"),
        });
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
