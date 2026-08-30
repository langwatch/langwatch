/**
 * Unit tests for the scenario infrastructure-error classifier.
 *
 * @see specs/scenarios/scenario-infra-error-surfacing.feature
 */

import { describe, expect, it } from "vitest";
// The shared needle couples this classifier to the four sites that actually
// throw the codex coding-assistant-surfaces refusal (codexGatewayModel.ts,
// api/routers/modelProviders.utils.ts, modelDefaults.service.ts x2), so a
// wording change at the source can't silently stop being recognised here.
import { CODING_ASSISTANT_SURFACES_ONLY_NEEDLE } from "../../modelProviders/codexRefusalMessage";
import {
  classifyScenarioInfraError,
  decodeScenarioError,
  encodeScenarioError,
  extractScenarioErrorText,
  isTransportLevelScenarioFailure,
  resolveScenarioError,
  ScenarioInfraErrorCode,
  scenarioErrorTitle,
} from "../scenario-infra-error";

/** The internals a user must never read, each with the name it fails under. */
const INTERNAL_MARKERS = [
  { label: "stack frame", pattern: /\bat\s+(?:async\s+)?\S+\s*\(/ },
  { label: "interpreter source location", pattern: /node:internal/ },
  {
    label: "container path",
    pattern: /(?:^|[\s'"])\/(?:app|usr|home|Users)\//,
  },
  { label: "child-process wrapper", pattern: /Child process exited/ },
  { label: "bundle filename", pattern: /\.cjs\b|\.js:/ },
  {
    label: "build tree",
    pattern: /(?:^|[\s'"(/\\])(?:dist|node_modules)[/\\]/,
  },
] as const;

/**
 * Nothing a user reads may carry a stack frame, an interpreter source
 * location, or a path from inside our container. Asserted on the message
 * rather than the input, so it holds whichever classification rule matched,
 * and reported by label so a failure names what leaked.
 */
function expectNoInternals(message: string): void {
  const leaked = INTERNAL_MARKERS.filter(({ pattern }) =>
    pattern.test(message),
  ).map(({ label }) => label);
  // biome-ignore lint/suspicious/noMisplacedAssertion: one shared guard for every "no internals" case; the assertion belongs with the marker list it checks
  expect(leaked).toEqual([]);
}

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

  describe("when the raw error is a name-resolution failure", () => {
    /** @scenario "A DNS resolution failure becomes an unreachable-endpoint error" */
    /** @scenario "A hostname that could not be resolved becomes an unreachable-endpoint error" */
    it.each([
      // A resolver failure that is not one of the errno codes already listed:
      // the getaddrinfo prefix is the part every form of it shares.
      "getaddrinfo EAI_FAIL agent.internal",
      "Error: getaddrinfo failed",
      // What curl and several HTTP clients print instead of an errno.
      "Could not resolve hostname agent.example.com",
      "could not resolve hostname",
    ])("classifies %s as platform unreachable", (raw) => {
      expect(classifyScenarioInfraError(raw).code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });
  });

  describe("when the raw error names the HTTP agent target it could not reach", () => {
    /** @scenario "An unreachable target names itself in the customer-facing message" */
    it("carries the target host into the customer-facing message", () => {
      const envelope = classifyScenarioInfraError(
        "HTTP agent target agent.example.com could not be reached: " +
          "getaddrinfo ENOTFOUND agent.example.com",
      );

      expect(envelope.code).toBe(ScenarioInfraErrorCode.PlatformUnreachable);
      expect(envelope.message).toContain("agent.example.com");
      expect(envelope.message).not.toContain("getaddrinfo");
    });

    /** @scenario "An unreachable endpoint with no named target keeps the generic message" */
    it("keeps the generic sentence when no target is named", () => {
      const envelope = classifyScenarioInfraError("TypeError: fetch failed");

      expect(envelope.code).toBe(ScenarioInfraErrorCode.PlatformUnreachable);
      expect(envelope.message).toBe(
        "Couldn't reach the endpoint while running the simulation.",
      );
    });
  });

  describe("when the raw error is the tunnel edge's HTTP 530 answer", () => {
    /** @scenario "A dead tunnel names itself without a devTunnel lookup" */
    it("classifies the Cloudflare 530 + 1033 pair as the named dev-tunnel error", () => {
      const envelope = classifyScenarioInfraError(
        "HTTP 530: error from https://gone.trycloudflare.com " +
          "(request-id: abc): <html><body>error code: 1033</body></html>",
      );

      expect(envelope.code).toBe(
        ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
      );
      expect(envelope.message).toBe(
        "The agent points at a local development tunnel that is no longer " +
          "responding. The `langwatch agent dev` session that created it has " +
          "probably ended.",
      );
      expect(envelope.hint).toContain("langwatch agent dev");
    });

    it("does not name a 530 without the 1033 body a dead tunnel", () => {
      const envelope = classifyScenarioInfraError(
        "HTTP 530: upstream error from https://my-agent.example.com: site frozen",
      );

      expect(envelope.code).not.toBe(
        ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
      );
      expect(
        isTransportLevelScenarioFailure(
          "HTTP 530: upstream error from https://my-agent.example.com",
        ),
      ).toBe(false);
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

  describe("when the judge model rejects reasoning with function tools", () => {
    /** @scenario "A remaining conflict is surfaced as a handled scenario error" */
    it("classifies the observed OpenAI JSON envelope without exposing provider prose", () => {
      const raw = JSON.stringify({
        error: {
          message:
            "Function tools with reasoning_effort are not supported in this endpoint. Use /v1/responses or set reasoning_effort to 'none'.",
          type: "invalid_request_error",
          code: null,
        },
      });

      const result = classifyScenarioInfraError(raw);

      expect(result.code).toBe(
        ScenarioInfraErrorCode.ModelToolReasoningConflict,
      );
      expect(result.message).toBe(
        "The selected judge model cannot use its current reasoning mode with the judge's function tool.",
      );
      expect(result.hint).toBe(
        "Choose a different judge model. If you manage this model request directly, use the Responses API or disable reasoning for Chat Completions.",
      );
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
      const result = classifyScenarioInfraError(
        "Something unexpected happened",
      );
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

  describe("when the runner process failed to boot", () => {
    // Verbatim from a customer report: the production bundle was built
    // without pino declared, so the child died in Node's CJS loader and the
    // whole dump — interpreter paths, stack frames, the bundle's absolute
    // path inside the container — was stored as the run's verdict reasoning.
    const moduleNotFoundDump = [
      "Child process exited with code 1: node:internal/modules/cjs/loader:1520",
      "  throw err;",
      "  ^",
      "",
      "Error: Cannot find module 'pino'",
      "Require stack:",
      "- /app/langwatch/langwatch/dist/scenario-child-process.js",
      "    at Module._resolveFilename (node:internal/modules/cjs/loader:1517:15)",
      "    at Module._load (node:internal/modules/cjs/loader:1294:5)",
      "{",
      "  code: 'MODULE_NOT_FOUND',",
      "  requireStack: [ '/app/langwatch/langwatch/dist/scenario-child-process.js' ]",
      "}",
      "",
      "Node.js v24.18.0",
      "",
    ].join("\n");

    /** @scenario "A runner that fails to boot becomes a named runner-unavailable error" */
    it("classifies the loader crash as runner-unavailable without leaking internals", () => {
      const result = classifyScenarioInfraError(moduleNotFoundDump);
      expect(result.code).toBe(ScenarioInfraErrorCode.RunnerUnavailable);
      expectNoInternals(result.message);
      expect(result.hint).toMatch(/fault on our side/i);
    });

    it("keeps the internals out of the reasoning the run stores", () => {
      // buildFailureResults() puts this string in the run's `reasoning`, which
      // is what the customer report showed the loader dump in. Pinned exactly,
      // because the whole point of the fix is the words the customer reads.
      expect(classifyScenarioInfraError(moduleNotFoundDump).message).toBe(
        "The simulation runner couldn't start, so the scenario never ran.",
      );
    });

    // Every case carries the child-exit wrapper, because that is what marks
    // the dead process as ours.
    it.each([
      [
        "a missing ESM package",
        "Child process exited with code 1: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod'\n    at Module._load (node:internal/modules/cjs/loader:1294:5)",
      ],
      [
        "a missing relative module",
        "Child process exited with code 1: Error: Cannot find module '../dist/index.js'\nRequire stack:\n- /app/dist/server/workers.cjs",
      ],
      [
        "an ESM/CJS mismatch",
        "Child process exited with code 1: Error [ERR_REQUIRE_ESM]: require() of ES Module not supported\n    at Module._compile (node:internal/modules/cjs/loader:1871:14)",
      ],
      [
        "a native addon that won't load",
        "Child process exited with code 1: Error: ERR_DLOPEN_FAILED: invalid ELF header\n    at Module._extensions..node (node:internal/modules/cjs/loader:1928:18)",
      ],
    ])("classifies %s as runner-unavailable", (_label, raw) => {
      expect(classifyScenarioInfraError(raw).code).toBe(
        ScenarioInfraErrorCode.RunnerUnavailable,
      );
    });
  });

  describe("when the crash text came from the customer's own agent", () => {
    /** @scenario "A customer's own module error is not blamed on our runner" */
    it("does not blame our runner for the agent's missing dependency", () => {
      // The real shape, not a toy: http-agent.adapter.ts embeds the customer's
      // HTTP response body verbatim, so their agent's own boot crash arrives
      // here looking exactly like ours — frames, Require stack and all. What
      // separates them is the child-exit wrapper, which only our dead child
      // gets. Telling them the fault is on our side would send them looking in
      // the wrong place for their own missing `stripe`.
      const agentBodyThroughAdapter = [
        "HTTP 500: Internal Server Error from https://acme.example.com/agent (request-id: abc-123): Error: Cannot find module 'stripe'",
        "Require stack:",
        "- /srv/customer-agent/handlers/pay.js",
        "    at Module._resolveFilename (node:internal/modules/cjs/loader:1517:15)",
      ].join("\n");

      const result = classifyScenarioInfraError(agentBodyThroughAdapter);

      expect(result.code).not.toBe(ScenarioInfraErrorCode.RunnerUnavailable);
      expect(result.hint ?? "").not.toMatch(/fault on our side/i);
    });

    it("does not blame our runner for a bare module sentence either", () => {
      const agentReply = "Cannot find module 'my-tools/pricing'";
      const result = classifyScenarioInfraError(agentReply);
      expect(result.code).toBe(ScenarioInfraErrorCode.Infra);
      expect(result.message).toBe(agentReply);
    });
  });

  describe("when the agent's own failure text contains a path", () => {
    /** @scenario "The agent's own failure text survives the internals guard" */
    it.each([
      [
        "the adapter's HTTP envelope",
        "HTTP 502: Bad Gateway from https://acme.example.com/agent (request-id: none): upstream /srv/agent/app.py raised ValueError",
      ],
      ["an unknown route", "unknown route /v2/chat"],
      ["a provider endpoint", "POST /v1/chat/completions returned 400"],
      ["a rate limit", "Rate limited on /v1/messages, retry after 30s"],
      ["a require-stack lookalike bullet", "- /webhooks/agent is unreachable"],
    ])("passes %s through untouched", (_label, raw) => {
      // A path is only an internal when it is OURS. These are all the
      // customer's own data and the most diagnostic thing they get.
      expect(classifyScenarioInfraError(raw).message).toBe(raw);
    });
  });

  describe("when the raw error is nothing but runtime noise", () => {
    /** @scenario "An unclassified crash dump degrades to a plain sentence" */
    it("degrades to a plain sentence rather than a stack frame", () => {
      // No loader needles here, so this lands in the generic bucket — the
      // path the old summarize() walked straight into, returning the
      // interpreter's own source location as the user-facing message.
      const framesOnly = [
        "Child process exited with code 1: node:internal/process/task_queues:105",
        "  throw err;",
        "  ^",
        "    at processTicksAndRejections (node:internal/process/task_queues:105:5)",
        "    at async /app/langwatch/dist/server/scenario-child-process.cjs:80978:27",
        "{",
        "  code: 'SOME_CODE'",
        "}",
        "",
        "Node.js v24.18.0",
      ].join("\n");
      const result = classifyScenarioInfraError(framesOnly);
      expect(result.code).toBe(ScenarioInfraErrorCode.Infra);
      expectNoInternals(result.message);
      // NOT "failed before it could run" — that asserts the run never started,
      // which is false for anything suppressed mid-run.
      expect(result.message).toBe(
        "The simulation failed, but it didn't report a reason we can show.",
      );
    });

    it.each([
      [
        "a bundle-relative frame",
        "Error thrown in dist/server/workers.cjs:80978",
      ],
      [
        "an async stack frame",
        "Caused by: at async Foo.bar (dist/server/x.js:1:1)",
      ],
      [
        "our runner bundle by name",
        "TypeError: x is not a function (scenario-child-process.cjs:80978:27)",
      ],
    ])("suppresses %s, which carries no leading slash", (_label, raw) => {
      expectNoInternals(classifyScenarioInfraError(raw).message);
    });

    it.each([
      [
        "backslash-separated",
        "Error thrown in C:\\app\\dist\\server\\scenario-child-process.cjs:80978",
      ],
      [
        "a UNC share",
        "Error thrown in \\\\build\\share\\dist\\server\\workers.cjs:12",
      ],
    ])("suppresses our bundle path when %s", (_label, raw) => {
      // The guard keys on our artefacts (dist, node_modules, .cjs, the runner
      // bundle's name) with either separator, rather than on path shape — so
      // the drive letter and the UNC prefix are beside the point. A bare
      // `C:\app\runner.js` is deliberately NOT suppressed: it names nothing of
      // ours, and blanket path suppression is what cost the customer their own
      // diagnostics in the case above.
      expectNoInternals(classifyScenarioInfraError(raw).message);
    });

    it("does not let an unbalanced bracket swallow the real sentence", () => {
      // The HTTP adapter truncates response bodies mid-string, so unbalanced
      // JSON reaches this classifier as a matter of course. A block may only
      // open on a line that STARTS with `{`; a stray bracket must not.
      const truncated = [
        'Child process exited with code 1: {"partial": [',
        "The judge could not parse the agent's reply.",
      ].join("\n");
      expect(classifyScenarioInfraError(truncated).message).toBe(
        "The judge could not parse the agent's reply.",
      );
    });

    it("still keeps a real sentence buried in a crash dump", () => {
      // The noise filter skips lines, it does not skip the whole blob: a
      // genuine explanation between the frames still reaches the user.
      const withRealLine = [
        "node:internal/process/task_queues:105",
        "  throw err;",
        "The judge could not parse the agent's reply.",
        "    at processTicksAndRejections (node:internal/process/task_queues:105:5)",
      ].join("\n");
      expect(classifyScenarioInfraError(withRealLine).message).toBe(
        "The judge could not parse the agent's reply.",
      );
    });
  });

  describe("when the raw error is a codex coding-assistant-surface refusal", () => {
    // Both real wordings the backstop emits (codexGatewayModel.ts and
    // api/routers/modelProviders.utils.ts / modelDefaults.service.ts)
    // share the same prefix built from the shared needle — different
    // suffixes name a different disallowed surface, but the classifier
    // only needs to recognise the shared part.
    const gatewayWording = `"openai_codex/gpt-5.6-terra" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot run "prompt.create_default".`;
    const litellmWording = `"openai_codex/gpt-5.6-terra" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot run workflows, evaluations or the playground.`;

    /** @scenario "A codex coding-assistant-surface refusal becomes a named, actionable error" */
    it.each([
      ["the featureKey-style wording (codexGatewayModel.ts)", gatewayWording],
      [
        "the litellm-params-style wording (modelProviders.utils.ts)",
        litellmWording,
      ],
    ])("classifies %s to the dedicated code", (_label, raw) => {
      const result = classifyScenarioInfraError(raw);
      expect(result.code).toBe(
        ScenarioInfraErrorCode.ModelNotAllowedForSurface,
      );
    });

    it("does not surface a raw stack trace in the message", () => {
      const raw = `Child process exited with code 1: ${gatewayWording}\n    at getCodexVercelAIModel (codexGatewayModel.ts:32:11)`;
      const result = classifyScenarioInfraError(raw);
      expect(result.message).not.toContain("at getCodexVercelAIModel");
      expect(result.message).not.toContain("Child process exited");
    });

    it("points the hint at the project's model default settings", () => {
      const result = classifyScenarioInfraError(gatewayWording);
      expect(result.hint).toMatch(/model default|default model/i);
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

  it("returns an already-encoded envelope unchanged", () => {
    const envelope = classifyScenarioInfraError("ECONNREFUSED");
    expect(resolveScenarioError(encodeScenarioError(envelope))).toEqual(
      envelope,
    );
  });

  /** @scenario "An SDK-recorded failure classifies the same as a processor-caught one" */
  it("names a dead tunnel from the SDK's own serialized failure", () => {
    // The scenario SDK records its own run failures as {name,message,stack}
    // JSON; those never pass through the failure handler, so the display
    // resolver is the classification for them.
    const raw = JSON.stringify({
      name: "Error",
      message:
        "[HttpAgent] HTTP 530: error from https://gone.trycloudflare.com " +
        "(request-id: abc): <!DOCTYPE html><html>error code: 1033</html>",
      stack: "Error: ...\n  at HttpAgent.call",
    });

    const result = resolveScenarioError(raw);

    expect(result.code).toBe(ScenarioInfraErrorCode.AgentDevTunnelUnreachable);
    expect(result.message).not.toContain("<");
    expect(result.hint).toContain("langwatch agent dev");
  });

  it("never renders an upstream's HTML error page as the failure reason", () => {
    const raw = JSON.stringify({
      name: "Error",
      message:
        "HTTP 502: error from https://my-agent.example.com (request-id: xyz): " +
        "<!DOCTYPE html>\n<html>\n<head><title>502 Bad Gateway</title></head>\n<body>outage</body>\n</html>",
      stack: "Error: ...",
    });

    const result = resolveScenarioError(raw);

    expect(result.message).not.toContain("<html");
    expect(result.message).not.toContain("DOCTYPE");
  });
});

describe("classifyScenarioInfraError session cap", () => {
  describe("when an adapter refused a session above the cap", () => {
    /** @scenario "A refused session reads as a named run error" */
    it("names the payload code with the sizes, a hint and a title", () => {
      const result = classifyScenarioInfraError(
        "Child process exited with code 1: Agent session too large (agent_payload_too_large): the agent returned a session of 70002 bytes, above the limit of 65536 bytes.",
      );

      expect(result.code).toBe(ScenarioInfraErrorCode.AgentPayloadTooLarge);
      expect(result.message).toContain("70002 bytes");
      expect(result.message).toContain("65536 bytes");
      expect(result.hint).toBeTruthy();
      expect(scenarioErrorTitle(result.code)).toBe("Agent answer too large");
    });
  });

  describe("when the relay refused a connected agent's answer", () => {
    it("classifies agent_payload_too_large under the same code", () => {
      const result = classifyScenarioInfraError(
        "Connected agent call failed (agent_payload_too_large): The result is 20000000 bytes, above the limit of 16777216 bytes.",
      );

      expect(result.code).toBe(ScenarioInfraErrorCode.AgentPayloadTooLarge);
      expect(result.hint).toBeTruthy();
    });
  });

  describe("when the connected agent's own error reads like a generic failure", () => {
    it("classifies a handler that timed out as a connected agent failure", () => {
      const result = classifyScenarioInfraError(
        "Connected agent call failed (agent_call_failed): the upstream request timed out after 30s",
      );

      expect(result.code).toBe(ScenarioInfraErrorCode.AgentCallFailed);
      expect(result.message).toContain("the upstream request timed out");
    });

    it("classifies a handler that reports an invalid key as a connected agent failure", () => {
      const result = classifyScenarioInfraError(
        "Connected agent call failed (agent_call_failed): the API key is invalid for this account",
      );

      expect(result.code).toBe(ScenarioInfraErrorCode.AgentCallFailed);
      expect(result.message).toContain("the API key is invalid");
    });

    it("classifies a handler whose words match the session rule as a connected agent failure", () => {
      const result = classifyScenarioInfraError(
        "Connected agent call failed (agent_call_failed): Agent session too large, the agent returned a session of 70002 bytes, above the limit of 65536 bytes.",
      );

      expect(result.code).toBe(ScenarioInfraErrorCode.AgentCallFailed);
      expect(result.message).toContain("Agent session too large");
    });
  });
});

describe("scenarioErrorTitle", () => {
  it("returns a distinct human title per code", () => {
    const titles = Object.values(ScenarioInfraErrorCode).map(
      scenarioErrorTitle,
    );
    expect(new Set(titles).size).toBe(titles.length);
    titles.forEach((t) => expect(t.length).toBeGreaterThan(0));
  });
});
