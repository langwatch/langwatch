import { describe, expect, it } from "vitest";

import {
  classifyScenarioInfraError,
  ScenarioInfraErrorCode,
  scenarioErrorTitle,
} from "../scenario-infra-error";

/**
 * The exact string the child process reported to the parent in production on
 * 2026-08-17, taken from the run's stdout result line. Kept verbatim so the
 * regression is pinned to what actually happened rather than a paraphrase.
 */
const PROD_GATEWAY_FAILURE =
  "[UserSimulatorAgent] AI_RetryError: Failed after 3 attempts. Last error: gateway_unavailable: Failed after 3 attempts. Last error: gateway_unavailable";

describe("classifyScenarioInfraError", () => {
  describe("when our model gateway could not dispatch the call", () => {
    /** @scenario "A model-gateway failure is named as ours and retryable" */
    it("classifies the production failure instead of dumping it", () => {
      const result = classifyScenarioInfraError(PROD_GATEWAY_FAILURE);

      expect(result.code).toBe(ScenarioInfraErrorCode.ModelGatewayUnavailable);
    });

    /** @scenario "A model-gateway failure never shows internal names" */
    it("shows the customer no internal names or codes", () => {
      const { message, hint } =
        classifyScenarioInfraError(PROD_GATEWAY_FAILURE);
      const shown = `${message} ${hint ?? ""}`;

      expect(shown).not.toContain("UserSimulatorAgent");
      expect(shown).not.toContain("AI_RetryError");
      expect(shown).not.toContain("gateway_unavailable");
      expect(shown).not.toContain("dispatcher_error");
    });

    /** @scenario "A model-gateway failure tells the customer it is our fault" */
    it("attributes the fault to us and says to retry", () => {
      const { message, hint } =
        classifyScenarioInfraError(PROD_GATEWAY_FAILURE);

      expect(message).toMatch(/our model gateway/i);
      expect(hint).toMatch(/on our side/i);
      expect(hint).toMatch(/again/i);
    });

    it("matches the gateway's own error envelope", () => {
      const raw =
        '{"error":{"type":"gateway_unavailable","code":"gateway_unavailable","message":"gateway_unavailable","meta":{"reason":"dispatcher_error"}}}';

      expect(classifyScenarioInfraError(raw).code).toBe(
        ScenarioInfraErrorCode.ModelGatewayUnavailable,
      );
    });

    it("has a drawer title", () => {
      expect(
        scenarioErrorTitle(ScenarioInfraErrorCode.ModelGatewayUnavailable),
      ).toBeTruthy();
    });
  });

  describe("when the provider throttled the request", () => {
    /** @scenario "A provider throttle is named separately from a rejection" */
    it.each([
      "insufficient_quota",
      "rate_limit_exceeded",
      "overloaded_error",
    ])("classifies %s as rate limited", (code) => {
      const raw = `[UserSimulatorAgent] provider returned {"error":{"type":"${code}","message":"You exceeded your current quota"}}`;

      expect(classifyScenarioInfraError(raw).code).toBe(
        ScenarioInfraErrorCode.ModelRateLimited,
      );
    });

    it("surfaces the provider's own sentence and an actionable hint", () => {
      const raw =
        '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}';
      const result = classifyScenarioInfraError(raw);

      expect(result.message).toContain("You exceeded your current quota");
      expect(result.hint).toMatch(/rate limit|spending cap|wait/i);
    });

    it("has a drawer title", () => {
      expect(
        scenarioErrorTitle(ScenarioInfraErrorCode.ModelRateLimited),
      ).toBeTruthy();
    });
  });

  describe("when a provider verdict arrives now that the gateway forwards it", () => {
    /** @scenario "Forwarded provider verdicts classify as provider errors" */
    it.each([
      "model_not_found",
      "invalid_request_error",
    ])("classifies %s as a provider error", (code) => {
      const raw = `{"error":{"type":"${code}","message":"The model does not exist"}}`;

      expect(classifyScenarioInfraError(raw).code).toBe(
        ScenarioInfraErrorCode.ModelProviderError,
      );
    });
  });

  describe("when an unclassified failure names an AI SDK error class", () => {
    /** @scenario "An unnamed SDK failure degrades to a plain sentence" */
    it("degrades to a plain sentence rather than leaking the class name", () => {
      const raw =
        "[UserSimulatorAgent] AI_NoObjectGeneratedError: could not parse the model output";
      const result = classifyScenarioInfraError(raw);

      expect(result.code).toBe(ScenarioInfraErrorCode.Infra);
      expect(result.message).not.toContain("AI_NoObjectGeneratedError");
    });
  });

  describe("when the customer's own agent reports being throttled", () => {
    /**
     * Their upstream, their data, their diagnostic. The provider-throttle rule
     * must key on a provider error code, never on the words "rate limit".
     *
     * @scenario "The agent's own failure text survives the internals guard"
     */
    it("passes the text through untouched", () => {
      const raw = "Rate limited on /v1/messages, retry after 30s";

      expect(classifyScenarioInfraError(raw).message).toBe(raw);
    });
  });
});
