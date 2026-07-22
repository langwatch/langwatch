/**
 * The exact live failure this pins: an agent ran
 * `langwatch evaluator create "quick-relevancy" --type "ragas/answer_relevancy"`
 * — a stale slug (the catalog has `ragas/response_relevancy` and
 * `legacy/ragas_answer_relevancy`) — and got a 422 whose reasons named the
 * field but not what it would have accepted, so the error's own "fix the
 * fields and retry" advice was impossible to follow.
 *
 * Runs the REAL `createEvaluatorInputSchema` through the REAL boundary
 * validator and error handler (same end-to-end posture as
 * server/api/__tests__/validation.unit.test.ts), so it executes the code path
 * the panel hit rather than asserting on strings.
 *
 * @see specs/evaluators/evaluator-create-validation.feature
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { handleError } from "~/app/api/middleware/error-handler";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators";
import { validator as zValidator } from "~/server/api/validation";
import { createEvaluatorInputSchema } from "../[[...route]]/schemas";

const app = new Hono();
app.onError(handleError);
app.post("/", zValidator("json", createEvaluatorInputSchema), (c) =>
  c.json({ ok: true, received: c.req.valid("json") }),
);

const post = (body: unknown) =>
  app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("creating an evaluator with an unknown type", () => {
  describe("when the type slug is not in the catalog", () => {
    const staleSlug = {
      name: "quick-relevancy",
      config: { evaluatorType: "ragas/answer_relevancy" },
    };

    /** @scenario Unknown evaluator type is rejected naming the exact field */
    it("answers 422 validation_error naming config.evaluatorType, not the whole config", async () => {
      const res = await post(staleSlug);

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      expect(body.fields).toEqual(["config.evaluatorType"]);
    });

    /** @scenario The rejection lists every type that would have been accepted */
    it("carries every accepted evaluator type as the reason's meta.expected", async () => {
      const res = await post(staleSlug);

      const body = await res.json();
      const [reason] = body.reasons;
      expect(reason.code).toBe("schema_failure");
      expect(reason.meta.field).toBe("config.evaluatorType");
      expect(reason.meta.expected).toEqual(
        Object.keys(AVAILABLE_EVALUATORS).sort(),
      );
      expect(reason.meta.received).toBe("ragas/answer_relevancy");
    });

    /** @scenario The rejection lists every type that would have been accepted */
    it("lists the slugs a stale ragas name should be corrected to", async () => {
      const res = await post(staleSlug);

      const body = await res.json();
      const expected = body.reasons[0].meta.expected as string[];
      expect(expected).toContain("ragas/response_relevancy");
      expect(expected).toContain("legacy/ragas_answer_relevancy");
    });

    /** @scenario The accepted types stay out of the prose message */
    it("keeps the accepted types out of the prose message", async () => {
      const res = await post(staleSlug);

      const body = await res.json();
      expect(body.reasons[0].meta.message).not.toContain(
        "ragas/response_relevancy",
      );
    });
  });

  describe("when config has no evaluatorType at all", () => {
    it("still rejects with the field requirement it always had", async () => {
      const res = await post({ name: "quick-relevancy", config: {} });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      expect(body.reasons[0].meta.message).toContain("evaluatorType");
    });
  });

  describe("when the type slug is valid", () => {
    it("passes the body through unchanged", async () => {
      const res = await post({
        name: "quick-relevancy",
        config: { evaluatorType: "ragas/response_relevancy" },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).received).toEqual({
        name: "quick-relevancy",
        config: { evaluatorType: "ragas/response_relevancy" },
      });
    });

    it("accepts the platform's native evaluators, not only the langevals catalog", async () => {
      const res = await post({
        name: "secrets-check",
        config: {
          evaluatorType: "langwatch/api_keys_and_secrets_detection",
        },
      });

      expect(res.status).toBe(200);
    });
  });
});
