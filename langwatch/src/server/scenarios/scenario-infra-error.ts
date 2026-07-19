/**
 * Classifies raw scenario-runner failures into a handled error the drawer can
 * render cleanly, instead of dumping a raw child-process stack trace at the
 * user.
 *
 * This is the scenario projection of the shared handled-error model — the same
 * `{ code, message, meta }` contract as Go's `pkg/herr` and the TypeScript
 * `HandledError` (`~/server/app-layer/handled-error.ts`), and the same
 * code-keyed explainer convention as `~/features/automations/logic/errorExplainer.ts`.
 * A stable string `code` is the discriminant; the human `message` is safe to
 * show; an optional `hint` is the actionable next step.
 *
 * The module is intentionally PURE (no OpenTelemetry, no server-only imports)
 * so it is safe to import from the run drawer on the client — it only needs to
 * decode + title the envelope. The failure path (server) does the classifying
 * and encoding; the drawer (client) decodes and renders.
 *
 * @see specs/scenarios/scenario-infra-error-surfacing.feature
 */

export const ScenarioInfraErrorCode = {
  /** The runner couldn't establish TLS because the certificate isn't trusted. */
  UntrustedCertificate: "scenario_untrusted_certificate",
  /** The runner couldn't reach the platform / target endpoint. */
  PlatformUnreachable: "scenario_platform_unreachable",
  /** The model provider rejected the request (bad key, unknown model, …). */
  ModelProviderError: "scenario_model_provider_error",
  /** The run exceeded its time budget. */
  ExecutionTimeout: "scenario_execution_timeout",
  /** Anything else that failed at the infrastructure level. */
  Infra: "scenario_infra_error",
} as const;

export type ScenarioInfraErrorCode =
  (typeof ScenarioInfraErrorCode)[keyof typeof ScenarioInfraErrorCode];

/**
 * The wire shape stored in a run's `results.error` field. Mirrors the herr
 * envelope (`{ type, message, meta }`) trimmed to what the drawer needs.
 */
export interface ScenarioErrorEnvelope {
  code: ScenarioInfraErrorCode;
  /** Human-readable, safe to show the user. Never a raw stack trace. */
  message: string;
  /** Optional actionable next step. */
  hint?: string;
}

/** Longest message we keep for the generic fallback; raw dumps get trimmed. */
const MAX_GENERIC_MESSAGE_LENGTH = 300;

/** Case-insensitive substring test that tolerates undefined. */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Pull the provider's own error text out of a gateway/provider failure. The Go
 * AI Gateway surfaces `{"error":{"message":"Model not found: …","type":"provider_error"}}`,
 * and the `ai` SDK throws messages like "API key is invalid." — we prefer the
 * innermost human sentence over the JSON wrapper.
 */
function extractProviderMessage(raw: string): string | undefined {
  const jsonMessage = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1];
  if (jsonMessage) return jsonMessage.replace(/\\"/g, '"').trim();

  const modelNotFound = /Model not found:\s*[^\n"]+/i.exec(raw)?.[0];
  if (modelNotFound) return modelNotFound.trim();

  if (contains(raw, "API key is invalid")) return "API key is invalid.";
  if (contains(raw, "Incorrect API key")) return "Incorrect API key provided.";

  return undefined;
}

/**
 * Collapse a raw error blob (often a multi-line child-process dump) into a
 * single concise line: strip the "Child process exited with code N:" wrapper
 * and any JSON-log noise, keep the first meaningful line, and cap the length.
 */
function summarize(raw: string): string {
  const withoutWrapper = raw
    .replace(/^Child process exited with code \d+:\s*/i, "")
    .trim();
  const firstMeaningfulLine =
    withoutWrapper
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("{")) ??
    withoutWrapper;
  const collapsed = firstMeaningfulLine.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_GENERIC_MESSAGE_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_GENERIC_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

/**
 * Classify a raw scenario-runner error string into a handled error envelope.
 *
 * Ordered most-specific-first: a TLS cert failure is more actionable than the
 * generic "fetch failed" it usually rides on, so it wins.
 */
export function classifyScenarioInfraError(
  raw: string | undefined,
): ScenarioErrorEnvelope {
  const text = (raw ?? "").trim();

  if (text.length === 0) {
    return {
      code: ScenarioInfraErrorCode.Infra,
      message: "The simulation failed before it could run.",
    };
  }

  // 1. Untrusted TLS certificate — the local-dev self-signed-cert case.
  if (
    contains(text, "self-signed certificate") ||
    contains(text, "self signed certificate") ||
    contains(text, "SELF_SIGNED_CERT_IN_CHAIN") ||
    contains(text, "DEPTH_ZERO_SELF_SIGNED_CERT") ||
    contains(text, "UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
    contains(text, "unable to get local issuer certificate")
  ) {
    return {
      code: ScenarioInfraErrorCode.UntrustedCertificate,
      message:
        "Couldn't establish a secure connection while running the simulation — the certificate presented by the server isn't trusted.",
      hint: "This is common in local development with self-signed certificates. Trust your local certificate authority (run `make haven setup`), or point NODE_EXTRA_CA_CERTS at your CA bundle so the simulation runner trusts it.",
    };
  }

  // 2. Model-provider rejection (bad key, unknown model, provider error).
  if (
    contains(text, "provider_error") ||
    contains(text, "API key is invalid") ||
    contains(text, "Incorrect API key") ||
    contains(text, "invalid_api_key") ||
    contains(text, "Model not found")
  ) {
    const providerMessage = extractProviderMessage(text);
    return {
      code: ScenarioInfraErrorCode.ModelProviderError,
      message: providerMessage
        ? `The model provider rejected the request: ${providerMessage}`
        : "The model provider rejected the request while running the simulation.",
      hint: "Check the model name and that the provider's API key is valid in your model provider settings.",
    };
  }

  // 3. Timeout.
  if (contains(text, "timed out") || contains(text, "ETIMEDOUT")) {
    return {
      code: ScenarioInfraErrorCode.ExecutionTimeout,
      message: "The simulation timed out before it finished.",
      hint: "The agent or model may be taking too long to respond. Try again, or simplify the scenario.",
    };
  }

  // 4. Network unreachable (connection refused / DNS / reset / undici fetch).
  if (
    contains(text, "ECONNREFUSED") ||
    contains(text, "ENOTFOUND") ||
    contains(text, "EAI_AGAIN") ||
    contains(text, "ECONNRESET") ||
    contains(text, "fetch failed") ||
    contains(text, "network error")
  ) {
    return {
      code: ScenarioInfraErrorCode.PlatformUnreachable,
      message: "Couldn't reach the endpoint while running the simulation.",
      hint: "Check that the target service is running and reachable from LangWatch.",
    };
  }

  // 5. Fallthrough — keep the (trimmed) message under a generic code so we
  //    never lose information, but never surface a raw dump.
  return {
    code: ScenarioInfraErrorCode.Infra,
    message: summarize(text),
  };
}

/** Encode an envelope for storage in the run's `results.error` string field. */
export function encodeScenarioError(envelope: ScenarioErrorEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Decode a run's `results.error` string back into an envelope. Returns null for
 * legacy plain-string errors (or anything that isn't one of our envelopes) so
 * callers can fall back to rendering the raw string.
 */
export function decodeScenarioError(
  raw: string | undefined | null,
): ScenarioErrorEnvelope | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
    return null;
  }
  const knownCode = (Object.values(ScenarioInfraErrorCode) as string[]).includes(
    candidate.code,
  );
  if (!knownCode) return null;
  return {
    code: candidate.code as ScenarioInfraErrorCode,
    message: candidate.message,
    ...(typeof candidate.hint === "string" ? { hint: candidate.hint } : {}),
  };
}

/**
 * Pull the human-readable text out of a run's raw error string.
 *
 * Runs report errors in a few shapes: the scenario SDK stores a serialized
 * `{ name, message, stack }` JSON (via the ingest path), while a child crash may
 * be a plain string. We take the `message` (falling back to `stack`, then the
 * raw string) so the classifier sees the real failure text — never a bare
 * `{name,message,stack}` wrapper.
 */
export function extractScenarioErrorText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        message?: unknown;
        stack?: unknown;
      };
      if (typeof parsed.message === "string" && parsed.message.length > 0) {
        return parsed.message;
      }
      if (typeof parsed.stack === "string" && parsed.stack.length > 0) {
        return parsed.stack;
      }
    } catch {
      // Not JSON — fall through to the raw string.
    }
  }
  return raw;
}

/**
 * Resolve any raw run-error string into a handled-error envelope for display.
 *
 * Prefers an already-encoded envelope (the failure handler's canonical output);
 * otherwise extracts the human text and classifies it. This is the single entry
 * point the run drawer uses so every error — envelope, SDK-serialized JSON, or
 * plain string — reads as one clean, actionable handled error.
 */
export function resolveScenarioError(raw: string): ScenarioErrorEnvelope {
  return (
    decodeScenarioError(raw) ??
    classifyScenarioInfraError(extractScenarioErrorText(raw))
  );
}

/** Short human title for an envelope code, for the drawer's error heading. */
export function scenarioErrorTitle(code: ScenarioInfraErrorCode): string {
  switch (code) {
    case ScenarioInfraErrorCode.UntrustedCertificate:
      return "Secure connection failed";
    case ScenarioInfraErrorCode.PlatformUnreachable:
      return "Couldn't reach the endpoint";
    case ScenarioInfraErrorCode.ModelProviderError:
      return "Model provider error";
    case ScenarioInfraErrorCode.ExecutionTimeout:
      return "Simulation timed out";
    case ScenarioInfraErrorCode.Infra:
      return "Simulation failed";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
