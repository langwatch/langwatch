import type { SerializedHandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  explainEvaluatorFailure,
  MISSING_MODEL_API_KEY,
  REFUSED_BY_ENDPOINT,
  UNRECOGNISED_FAILURE,
} from "../explainEvaluatorFailure";

/**
 * The classification behind the comparison cell.
 *
 * Two properties matter and neither is about wording. A third party's sentence
 * must never become our headline — that is how AWS API Gateway's "Missing
 * Authentication Token", about neither LangWatch nor the model provider, came
 * to be rendered as though the user's LangWatch token were missing. And the
 * tone must follow `fault`, so a run the user has to go and configure stops
 * being painted as a run that broke.
 */

const handled = (
  over: Partial<SerializedHandledError> & { code: string },
): SerializedHandledError =>
  ({
    kind: over.code,
    meta: {},
    traceId: undefined,
    spanId: undefined,
    httpStatus: 502,
    fault: "platform",
    reasons: [],
    ...over,
  }) as SerializedHandledError;

const AWS_GATEWAY_403 = '403 {\n  "message": "Missing Authentication Token"\n}';

describe("explainEvaluatorFailure", () => {
  describe("given a refusal whose response names no credential", () => {
    it("does not blame the model API key", () => {
      const { headline } = explainEvaluatorFailure({
        details: AWS_GATEWAY_403,
      });

      expect(headline).toBe(REFUSED_BY_ENDPOINT.headline);
      expect(headline).not.toBe(MISSING_MODEL_API_KEY.headline);
    });

    it("keeps the upstream's own words as evidence, never as the headline", () => {
      const { headline, raw } = explainEvaluatorFailure({
        details: AWS_GATEWAY_403,
      });

      expect(raw).toBe(AWS_GATEWAY_403);
      expect(headline).not.toContain("403 {");
      expect(headline).not.toContain("Missing Authentication Token");
    });
  });

  describe("given a refusal whose response names a key", () => {
    it("says so, because that advice is provable", () => {
      const { headline } = explainEvaluatorFailure({
        details: "AuthenticationError: bad api key",
      });

      expect(headline).toBe(MISSING_MODEL_API_KEY.headline);
    });
  });

  describe("when the same refusal arrives structurally and as raw text", () => {
    it("says the same thing through either door", () => {
      const structural = explainEvaluatorFailure({
        error: handled({
          code: "evaluator_execution_error",
          meta: { httpStatus: 403, reason: "auth_failed" },
          fault: "customer",
        }),
        details: AWS_GATEWAY_403,
      });
      const legacy = explainEvaluatorFailure({ details: AWS_GATEWAY_403 });

      expect(structural.headline).toBe(legacy.headline);
      expect(structural.tone).toBe(legacy.tone);
    });
  });

  describe("given a fault buried in the reasons chain", () => {
    // EvaluatorExecutionError defaults to `platform` because the evaluator
    // backend is ours; only an inner layer knows the call was the customer's
    // credential. Reading the outer default as an answer paints it red.
    it("reads the layer that actually classified itself", () => {
      const { tone } = explainEvaluatorFailure({
        error: handled({
          code: "evaluator_execution_error",
          fault: undefined,
          reasons: [
            {
              code: "provider_rejected",
              kind: "provider_rejected",
              fault: "customer",
            },
          ],
        } as never),
      });

      expect(tone).toBe("configuration");
    });

    it("finds an auth marker nested in the chain", () => {
      const { headline } = explainEvaluatorFailure({
        error: handled({
          code: "evaluator_execution_error",
          reasons: [
            {
              code: "provider_rejected",
              kind: "provider_rejected",
              meta: { reason: "auth_failed" },
            },
          ],
        } as never),
        details: AWS_GATEWAY_403,
      });

      expect(headline).toBe(REFUSED_BY_ENDPOINT.headline);
    });
  });

  describe("given a genuine execution failure", () => {
    it("stays an error rather than a configuration prompt", () => {
      const { tone } = explainEvaluatorFailure({
        error: handled({
          code: "evaluator_execution_error",
          fault: "platform",
        }),
        details: "connection reset",
      });

      expect(tone).toBe("failure");
    });

    it("keeps a timeout an error", () => {
      const { headline, tone } = explainEvaluatorFailure({
        details: "Request timed out after 60s",
      });

      expect(headline).toMatch(/timed out/i);
      expect(tone).toBe("failure");
    });
  });

  describe("given something unrecognised", () => {
    it("uses our own sentence and keeps theirs as evidence", () => {
      const body = '500 {\n  "message": "Internal server error"\n}';
      const { headline, raw } = explainEvaluatorFailure({ details: body });

      expect(headline).toBe(UNRECOGNISED_FAILURE.headline);
      expect(raw).toBe(body);
    });
  });

  describe("given nothing at all", () => {
    it("still says something rather than rendering an empty cell", () => {
      const { headline, raw } = explainEvaluatorFailure({});

      expect(headline).toBeTruthy();
      expect(raw).toBeUndefined();
    });
  });

  describe("given our own server-written waiting message", () => {
    // The one case where the detail IS the headline, because we wrote it —
    // it names the variants and is already customer-facing prose.
    it("splits it into headline and hint", () => {
      const { headline, hint, tone } = explainEvaluatorFailure({
        details: "Waiting on Variant A — no output for this row yet.",
      });

      expect(headline).toBe("Waiting on Variant A");
      expect(hint).toBe("no output for this row yet.");
      expect(tone).toBe("configuration");
    });
  });
});
