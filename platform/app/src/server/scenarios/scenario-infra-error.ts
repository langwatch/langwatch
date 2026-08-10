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

import { CODING_ASSISTANT_SURFACES_ONLY_NEEDLE } from "../modelProviders/codexRefusalMessage";

export const ScenarioInfraErrorCode = {
  /** The runner couldn't establish TLS because the certificate isn't trusted. */
  UntrustedCertificate: "scenario_untrusted_certificate",
  /** The runner couldn't reach the platform / target endpoint. */
  PlatformUnreachable: "scenario_platform_unreachable",
  /** The model provider rejected the request (bad key, unknown model, …). */
  ModelProviderError: "scenario_model_provider_error",
  /** The resolved model is licensed for the coding-assistant surfaces only and can't run this simulation. */
  ModelNotAllowedForSurface: "scenario_model_not_allowed_for_surface",
  /** The judge combined a forced function tool with incompatible reasoning. */
  ModelToolReasoningConflict: "scenario_model_tool_reasoning_conflict",
  /** The run exceeded its time budget. */
  ExecutionTimeout: "scenario_execution_timeout",
  /** The runner process itself couldn't boot (a broken build or deployment). */
  RunnerUnavailable: "scenario_runner_unavailable",
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

/** Shown when the raw error is empty, or is nothing but runtime noise. */
const GENERIC_FAILURE_MESSAGE = "The simulation failed before it could run.";

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
 * Lines that carry no meaning for a user and expose our internals: stack
 * frames, the interpreter's own source locations, the `throw err; ^` preamble
 * Node prints above an uncaught throw, `Require stack:` path lists, and the
 * trailing runtime-version footer.
 *
 * The generic fallback picks the first line that survives this filter, so an
 * unclassified crash dump degrades to a plain sentence rather than leaking a
 * path like `node:internal/modules/cjs/loader:1520` — which is what the
 * fallback used to show for a runner that failed to boot.
 */
const NOISE_LINE_PATTERNS: RegExp[] = [
  /^at\s/,
  /^node:/,
  /^\^+$/,
  /^throw\s/,
  /^Require stack:/i,
  /^-\s*[/\\]/,
  /^[/\\][^\s]*$/,
  /^Node\.js\s+v?\d/i,
];

/** True when a line is pure runtime noise rather than a human explanation. */
function isNoiseLine(line: string): boolean {
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Anything that betrays where our code lives or how it is built: an
 * interpreter source location, a stack frame, or an absolute filesystem path.
 *
 * This is the final guard on the generic bucket — the line filter above works
 * by enumeration, and enumeration always lags the next crash shape, so a
 * candidate that still matches here is dropped for the generic sentence rather
 * than shown. The path pattern needs the slash to start the line or follow
 * whitespace/a quote, which is why a URL's `https://host/v1/x` never trips it.
 */
const INTERNALS_PATTERNS: RegExp[] = [
  /node:internal/,
  /\bat\s+\S+\s+\(/,
  /(?:^|[\s'"(])[/\\][\w.-]+[/\\][\w.-]+/,
];

/** True when a candidate message would expose our internals to the user. */
function exposesInternals(message: string): boolean {
  return INTERNALS_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * The first line of a crash dump that reads as a human explanation.
 *
 * Node prints the error's own properties as a brace block under the stack
 * (`{ code: 'MODULE_NOT_FOUND', requireStack: [ '/app/…' ] }`). Skipping only
 * the opening brace would leave its inner lines as candidates, so depth is
 * tracked and the block skipped whole.
 */
function findMeaningfulLine(text: string): string | undefined {
  let depth = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const insideBlock = depth > 0;
    depth = Math.max(
      0,
      depth +
        (line.match(/[{[]/g)?.length ?? 0) -
        (line.match(/[}\]]/g)?.length ?? 0),
    );
    if (insideBlock || line.startsWith("{") || line.length === 0) continue;
    if (!isNoiseLine(line)) return line;
  }
  return undefined;
}

/**
 * Collapse a raw error blob (often a multi-line child-process dump) into a
 * single concise line: strip the "Child process exited with code N:" wrapper
 * and any runtime noise, keep the first meaningful line, and cap the length.
 *
 * Returns undefined when nothing but noise is left, so the caller falls back to
 * a generic sentence instead of surfacing a stack frame.
 */
function summarize(raw: string): string | undefined {
  const withoutWrapper = raw
    .replace(/^Child process exited with code \d+:\s*/i, "")
    .trim();
  const meaningful = findMeaningfulLine(withoutWrapper);
  if (!meaningful || exposesInternals(meaningful)) return undefined;
  const collapsed = meaningful.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_GENERIC_MESSAGE_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_GENERIC_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

interface ClassificationRule {
  /** Any one of these appearing in the raw error selects this rule. */
  needles: string[];
  /**
   * Optional second condition — the rule then needs a needle AND this. Used
   * where the needle words alone don't say whose process actually failed.
   */
  alsoRequires?: (text: string) => boolean;
  /** Build the envelope for a matched raw error. */
  build: (text: string) => ScenarioErrorEnvelope;
}

/**
 * Markers that only an uncaught Node crash prints: a loader frame, the
 * `Require stack:` list, or an internal module frame.
 *
 * The module-resolution words on their own don't identify the process that
 * died — a customer's own Node agent can fail with `Cannot find module` and
 * have that text surface through the adapter. Telling them "this is a fault on
 * our side" would then be worse than saying nothing, so the runner rule needs
 * one of these too, and a bare sentence falls through to the generic bucket
 * where the customer's own text is passed on unchanged.
 */
const NODE_CRASH_MARKERS = [
  "node:internal/modules",
  "Require stack:",
  "at Module._",
];

/** True when the blob is a Node process's own crash dump. */
function isNodeCrashDump(text: string): boolean {
  return NODE_CRASH_MARKERS.some((marker) => contains(text, marker));
}

/**
 * Classification rules, ordered most-specific-first: a TLS cert failure is more
 * actionable than the generic "fetch failed" it usually rides on, so it wins.
 */
const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    // Untrusted TLS certificate — the local-dev self-signed-cert case.
    needles: [
      "self-signed certificate",
      "self signed certificate",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "unable to get local issuer certificate",
    ],
    build: () => ({
      code: ScenarioInfraErrorCode.UntrustedCertificate,
      message:
        "Couldn't establish a secure connection while running the simulation — the certificate presented by the server isn't trusted.",
      hint: "This is common in local development with self-signed certificates. Trust your local certificate authority (run `haven up`, which installs and trusts it), or point NODE_EXTRA_CA_CERTS at your CA bundle so the simulation runner trusts it.",
    }),
  },
  {
    // OpenAI Chat Completions rejects the exact combination Scenario's judge
    // uses when a model enables reasoning by default. Keep this before the
    // generic provider rule so the user gets an actionable, prose-free
    // handled error even if an unrecognised model reaches the provider.
    needles: ["Function tools with reasoning_effort are not supported"],
    build: () => ({
      code: ScenarioInfraErrorCode.ModelToolReasoningConflict,
      message:
        "The selected judge model cannot use its current reasoning mode with the judge's function tool.",
      hint: "Choose a different judge model. If you manage this model request directly, use the Responses API or disable reasoning for Chat Completions.",
    }),
  },
  {
    // A terms-restricted model (codex) ran outside the coding-assistant
    // surfaces its plan licenses — the resolver only lets a saved value
    // reach execution when it predates the restriction (see
    // resolveModelForFeature.ts's restricted-model skip). Kept ahead of the
    // generic model-provider rule below since this is the more specific,
    // more actionable failure.
    needles: [CODING_ASSISTANT_SURFACES_ONLY_NEEDLE],
    build: () => ({
      code: ScenarioInfraErrorCode.ModelNotAllowedForSurface,
      message:
        "The configured model is only licensed for coding-assistant features and can't run this simulation.",
      hint: "Choose a different default model in Settings > Model Providers.",
    }),
  },
  {
    // Model-provider rejection (bad key, unknown model, provider error).
    needles: [
      "provider_error",
      "API key is invalid",
      "Incorrect API key",
      "invalid_api_key",
      "Model not found",
    ],
    build: (text) => {
      const providerMessage = extractProviderMessage(text);
      return {
        code: ScenarioInfraErrorCode.ModelProviderError,
        message: providerMessage
          ? `The model provider rejected the request: ${providerMessage}`
          : "The model provider rejected the request while running the simulation.",
        hint: "Check the model name and that the provider's API key is valid in your model provider settings.",
      };
    },
  },
  {
    // The runner process died before it could run anything — a module missing
    // from the production bundle, a native addon that won't load, an ESM/CJS
    // mismatch. Always our deployment, never the customer's scenario, so the
    // copy says so plainly instead of dumping the loader's stack. The build
    // gate in scripts/build-server.mjs is what stops the common cause (an
    // external require that isn't declared in dependencies) from shipping;
    // this rule is the user-facing half for anything that still gets through.
    needles: [
      "MODULE_NOT_FOUND",
      "ERR_MODULE_NOT_FOUND",
      "Cannot find module",
      "Cannot find package",
      "ERR_REQUIRE_ESM",
      "ERR_DLOPEN_FAILED",
    ],
    alsoRequires: isNodeCrashDump,
    build: () => ({
      code: ScenarioInfraErrorCode.RunnerUnavailable,
      message:
        "The simulation runner couldn't start, so the scenario never ran.",
      hint: "This is a fault on our side, not a problem with your scenario. Retry the run, and contact support if it keeps happening.",
    }),
  },
  {
    needles: ["timed out", "ETIMEDOUT"],
    build: () => ({
      code: ScenarioInfraErrorCode.ExecutionTimeout,
      message: "The simulation timed out before it finished.",
      hint: "The agent or model may be taking too long to respond. Try again, or simplify the scenario.",
    }),
  },
  {
    // Network unreachable (connection refused / DNS / reset / undici fetch).
    needles: [
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNRESET",
      "fetch failed",
      "network error",
    ],
    build: () => ({
      code: ScenarioInfraErrorCode.PlatformUnreachable,
      message: "Couldn't reach the endpoint while running the simulation.",
      hint: "Check that the target service is running and reachable from LangWatch.",
    }),
  },
];

/**
 * Classify a raw scenario-runner error string into a handled error envelope.
 *
 * Falls back to a trimmed generic message so we never lose information, but
 * never surface a raw dump.
 */
export function classifyScenarioInfraError(
  raw: string | undefined,
): ScenarioErrorEnvelope {
  const text = (raw ?? "").trim();

  if (text.length === 0) {
    return {
      code: ScenarioInfraErrorCode.Infra,
      message: GENERIC_FAILURE_MESSAGE,
    };
  }

  for (const rule of CLASSIFICATION_RULES) {
    const hit = rule.needles.some((needle) => contains(text, needle));
    if (hit && (rule.alsoRequires?.(text) ?? true)) {
      return rule.build(text);
    }
  }

  return {
    code: ScenarioInfraErrorCode.Infra,
    message: summarize(text) ?? GENERIC_FAILURE_MESSAGE,
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
  if (
    typeof candidate.code !== "string" ||
    typeof candidate.message !== "string"
  ) {
    return null;
  }
  const knownCode = (
    Object.values(ScenarioInfraErrorCode) as string[]
  ).includes(candidate.code);
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
    case ScenarioInfraErrorCode.ModelNotAllowedForSurface:
      return "Model not allowed for this simulation";
    case ScenarioInfraErrorCode.ModelToolReasoningConflict:
      return "Judge model configuration conflict";
    case ScenarioInfraErrorCode.ExecutionTimeout:
      return "Simulation timed out";
    case ScenarioInfraErrorCode.RunnerUnavailable:
      return "Simulation runner unavailable";
    case ScenarioInfraErrorCode.Infra:
      return "Simulation failed";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
