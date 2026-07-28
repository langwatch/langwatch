/**
 * Unit tests for the scenario infrastructure-error classifier.
 *
 * @see specs/scenarios/scenario-infra-error-surfacing.feature
 */

import { describe, expect, it } from "vitest";
import {
  ScenarioInfraErrorCode,
  classifyScenarioInfraError,
  decodeScenarioError,
  encodeScenarioError,
  extractScenarioErrorText,
  resolveScenarioError,
  scenarioErrorTitle,
} from "../scenario-infra-error";

describe("classifyScenarioInfraError", () => {
  describe("when the raw error is a self-signed certificate failure", () => {
    /** @scenario "A self-signed certificate failure becomes an untrusted-certificate error" */
    it("classifies the human-readable message and cert code", () => {
      const raw =
        "Child process exited with code 1: fetch failed: self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)";
      const result = classifyScenarioInfraError(raw);
      expect(result.code).toBe(ScenarioInfraErrorCode.UntrustedCertificate);
      expect(result.message).not.toContain("Child process exited");
      expect(result.message).not.toContain("SELF_SIGNED_CERT_IN_CHAIN");
      expect(result.hint).toMatch(/certificate authority|NODE_EXTRA_CA_CERTS/i);
    });

    it("also matches the raw Node error code without a message", () => {
      expect(
        classifyScenarioInfraError("Error: DEPTH_ZERO_SELF_SIGNED_CERT").code,
      ).toBe(ScenarioInfraErrorCode.UntrustedCertificate);
    });

    it("matches the real UserSimulatorAgent retry message (from Grafana)", () => {
      const raw =
        "[UserSimulatorAgent] AI_RetryError: Failed after 3 attempts. Last error: Cannot connect to API: self-signed certificate in certificate chain";
      const result = classifyScenarioInfraError(raw);
      expect(result.code).toBe(ScenarioInfraErrorCode.UntrustedCertificate);
      expect(result.message).not.toContain("AI_RetryError");
    });
  });

  describe("when the raw error is a connection failure", () => {
    /** @scenario "A connection failure becomes an unreachable-endpoint error" */
    it.each([
      "connect ECONNREFUSED 127.0.0.1:443",
      "getaddrinfo ENOTFOUND app.main.langwatch.localhost",
      "TypeError: fetch failed",
    ])("classifies %s as platform unreachable", (raw) => {
      expect(classifyScenarioInfraError(raw).code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });
  });

  describe("when the raw error is a model-provider rejection", () => {
    /** @scenario "A model-provider rejection becomes a model-provider error" */
    it("surfaces the provider's JSON message", () => {
      const raw =
        '{"error":{"message":"Model not found: grok-4-5","meta":{"status":400},"type":"provider_error"}}';
      const result = classifyScenarioInfraError(raw);
      expect(result.code).toBe(ScenarioInfraErrorCode.ModelProviderError);
      expect(result.message).toContain("Model not found: grok-4-5");
    });

    it("recognises an invalid API key", () => {
      const result = classifyScenarioInfraError(
        "primary provider anthropic returned error: API key is invalid.",
      );
      expect(result.code).toBe(ScenarioInfraErrorCode.ModelProviderError);
      expect(result.message).toContain("API key is invalid");
    });
  });

  describe("when the raw error is a timeout", () => {
    /** @scenario "A timeout becomes an execution-timeout error" */
    it("classifies it as an execution timeout", () => {
      expect(
        classifyScenarioInfraError("Scenario execution timed out").code,
      ).toBe(ScenarioInfraErrorCode.ExecutionTimeout);
    });
  });

  describe("when the raw error is unrecognised", () => {
    /** @scenario "An unrecognised failure keeps its message under a generic infra code" */
    it("keeps the message under the generic infra code", () => {
      const result = classifyScenarioInfraError("Something unexpected happened");
      expect(result.code).toBe(ScenarioInfraErrorCode.Infra);
      expect(result.message).toBe("Something unexpected happened");
      expect(result.hint).toBeUndefined();
    });

    it("strips the child-process wrapper and trims long dumps", () => {
      const longLine = "boom ".repeat(200).trim();
      const result = classifyScenarioInfraError(
        `Child process exited with code 1: ${longLine}`,
      );
      expect(result.code).toBe(ScenarioInfraErrorCode.Infra);
      expect(result.message.startsWith("boom")).toBe(true);
      expect(result.message.length).toBeLessThanOrEqual(300);
    });

    it("falls back to a safe message for an empty error", () => {
      const result = classifyScenarioInfraError(undefined);
      expect(result.code).toBe(ScenarioInfraErrorCode.Infra);
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  describe("when multiple failure reasons overlap in the raw error", () => {
    it("prefers the cert reason over the fetch-failed it rides on", () => {
      const raw =
        "TypeError: fetch failed: self-signed certificate in certificate chain";
      expect(classifyScenarioInfraError(raw).code).toBe(
        ScenarioInfraErrorCode.UntrustedCertificate,
      );
    });
  });
});

describe("encodeScenarioError / decodeScenarioError", () => {
  /** @scenario "The handled error round-trips through the results error field" */
  it("round-trips code, message, and hint", () => {
    const envelope = classifyScenarioInfraError(
      "self-signed certificate in certificate chain",
    );
    const decoded = decodeScenarioError(encodeScenarioError(envelope));
    expect(decoded).toEqual(envelope);
  });

  it("returns null for a plain non-envelope string", () => {
    expect(decodeScenarioError("Child process exited with code 1")).toBeNull();
    expect(decodeScenarioError("")).toBeNull();
    expect(decodeScenarioError(null)).toBeNull();
  });

  it("returns null for JSON that isn't one of our envelopes", () => {
    expect(decodeScenarioError('{"foo":"bar"}')).toBeNull();
    expect(decodeScenarioError('{"code":"nope","message":"x"}')).toBeNull();
  });
});

describe("extractScenarioErrorText", () => {
  it("pulls the message out of a serialized {name,message,stack} error", () => {
    const raw = JSON.stringify({
      name: "Error",
      message: "self-signed certificate in certificate chain",
      stack: "Error: ...\n  at somewhere",
    });
    expect(extractScenarioErrorText(raw)).toBe(
      "self-signed certificate in certificate chain",
    );
  });

  it("returns a plain string unchanged", () => {
    expect(extractScenarioErrorText("boom")).toBe("boom");
  });
});

describe("resolveScenarioError", () => {
  it("classifies the SDK's serialized cert error into a handled envelope", () => {
    const raw = JSON.stringify({
      name: "Error",
      message:
        "[UserSimulatorAgent] AI_RetryError: Failed after 3 attempts. Last error: Cannot connect to API: self-signed certificate in certificate chain",
      stack: "Error: ...\n  at ScenarioExecution.callAgent",
    });
    const result = resolveScenarioError(raw);
    expect(result.code).toBe(ScenarioInfraErrorCode.UntrustedCertificate);
    expect(result.message).not.toContain("at ScenarioExecution");
    expect(result.hint).toBeDefined();
  });

  describe("when the agent's own code is what failed", () => {
    // The adapter's headline (lw#3439). Its detail is the customer's own
    // Python, so it routinely contains words this classifier scans for —
    // the reported customer case is literally "The read operation timed out".
    const userCodeFailure = [
      "SerializedCodeAgentAdapter: user code raised an error during execution.",
      "  type: TimeoutException",
      "  user code error:",
      '    File "<code-block>", line 3, in execute',
      "    httpx.TimeoutException: The read operation timed out",
    ].join("\n");

    /** @scenario A failure in the agent's own code is not reported as our infrastructure failing */
    it("does not report the agent's own timeout as an execution timeout", () => {
      const result = classifyScenarioInfraError(userCodeFailure);

      expect(result.code).toBe(ScenarioInfraErrorCode.UserCodeError);
      expect(result.code).not.toBe(ScenarioInfraErrorCode.ExecutionTimeout);
      expect(result.message).toMatch(/TimeoutException|read operation timed out/);
      expect(result.message).not.toMatch(/The simulation timed out/);
    });

    /** @scenario A failure in the agent's code is not reported as an unreachable endpoint */
    it("does not report the agent's own connection error as an unreachable endpoint", () => {
      const result = classifyScenarioInfraError(
        [
          "SerializedCodeAgentAdapter: user code raised an error during execution.",
          "  type: ConnectError",
          "  user code error:",
          "    httpx.ConnectError: [Errno 111] ECONNREFUSED",
        ].join("\n"),
      );

      expect(result.code).toBe(ScenarioInfraErrorCode.UserCodeError);
      expect(result.message).not.toMatch(/Couldn't reach the endpoint/);
    });

    /** @scenario An adapter that never got a response is an execution timeout, not a generic failure */
    it("still classifies a genuine infra timeout as an execution timeout", () => {
      // The guard must not swallow the real thing it sits in front of.
      const result = classifyScenarioInfraError(
        "SerializedCodeAgentAdapter: NLP service did not respond within 120000ms (request aborted).",
      );
      expect(result.code).toBe(ScenarioInfraErrorCode.ExecutionTimeout);
      expect(result.hint).toBeDefined();
    });

    it("never renders a raw dump", () => {
      const huge = `SerializedCodeAgentAdapter: user code raised an error during execution.\n${"x".repeat(5_000)}`;
      expect(classifyScenarioInfraError(huge).message.length).toBeLessThan(500);
    });
  });

  it("returns an already-encoded envelope unchanged", () => {
    const envelope = classifyScenarioInfraError("ECONNREFUSED");
    expect(resolveScenarioError(encodeScenarioError(envelope))).toEqual(
      envelope,
    );
  });
});

describe("scenarioErrorTitle", () => {
  it("returns a distinct human title per code", () => {
    const titles = Object.values(ScenarioInfraErrorCode).map(scenarioErrorTitle);
    expect(new Set(titles).size).toBe(titles.length);
    titles.forEach((t) => expect(t.length).toBeGreaterThan(0));
  });
});
