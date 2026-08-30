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
  /**
   * The target agent points at a `langwatch agent dev` tunnel whose session
   * seems to have ended. Same code as the app-level handled error
   * (`AgentDevTunnelUnreachableError`) so the two surfaces name the failure
   * identically.
   */
  AgentDevTunnelUnreachable: "agent_dev_tunnel_unreachable",
  /**
   * Connected agent failures (ADR-128), named with the same codes the relay
   * route answers with so a run and a REST caller read one vocabulary.
   */
  AgentOffline: "agent_offline",
  AgentCallTimeout: "agent_call_timeout",
  AgentCallFailed: "agent_call_failed",
  AgentDisconnected: "agent_disconnected",
  AgentInstanceLost: "agent_instance_lost",
  AgentBusy: "agent_busy",
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

/** Shown when there is no raw error at all — nothing ever reported a reason. */
const GENERIC_FAILURE_MESSAGE = "The simulation failed before it could run.";

/**
 * Shown when there IS a raw error but none of it can be shown safely.
 *
 * Deliberately not GENERIC_FAILURE_MESSAGE: that one asserts the run never
 * started, which is false for a failure suppressed mid-run and lands in the
 * verdict a customer reads. A vaguer true sentence beats a precise false one.
 */
const UNREADABLE_FAILURE_MESSAGE =
  "The simulation failed, but it didn't report a reason we can show.";

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
const NOISE_LINE_PATTERNS = [
  /^at\s/,
  /^node:/,
  /^\^+$/,
  /^throw\s/,
  /^Require stack:/i,
  // A `Require stack:` entry is a bare path and nothing else. Without the
  // end anchor this also ate prose bullets like "- /webhooks/agent is down".
  /^-\s*[/\\]\S*$/,
  /^[/\\][^\s]*$/,
  /^Node\.js\s+v?\d/i,
  // Markup: an upstream's HTML error page (a gateway's 502 body, Cloudflare's
  // tunnel page) travels inside adapter errors, and none of it is a sentence
  // a user should read as the failure reason.
  /^<[!/a-zA-Z]/,
] as const;

/** True when a line is pure runtime noise rather than a human explanation. */
function isNoiseLine(line: string): boolean {
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Anything that betrays where OUR code lives or how it is built: an
 * interpreter source location, a stack frame, our container root, or our build
 * tree and bundle filenames.
 *
 * This is the final guard on the generic bucket — the line filter above works
 * by enumeration, and enumeration always lags the next crash shape, so a
 * candidate that still matches here is dropped for a generic sentence rather
 * than shown.
 *
 * These name our own artefacts deliberately. An earlier cut matched ANY
 * two-segment slash path, which also swallowed the single most diagnostic
 * string the runner produces — the HTTP adapter's
 * `HTTP 502: … from <url> (request-id: …): <body>` (http-agent.adapter.ts).
 * That line is all the customer's own data, so suppressing it cost them the
 * status, the URL, the request id and their own error body to hide nothing.
 * A path is only an internal when it is ours.
 */
const INTERNALS_PATTERNS = [
  /\bnode:[a-z_]+/,
  // `at Foo (…)` and `at async Foo.bar (…)` — the async form has an extra
  // token, which a fixed `\S+\s+\(` shape missed.
  /\bat\s+(?:async\s+)?\S+\s*\(/,
  /(?:^|[\s'"(])\/app\//,
  /(?:^|[\s'"(/\\])(?:dist|node_modules)[/\\]/,
  /\bscenario-child-process\b/,
  /\.cjs\b/,
] as const;

/** True when a candidate message would expose our internals to the user. */
function exposesInternals(message: string): boolean {
  return INTERNALS_PATTERNS.some((pattern) => pattern.test(message));
}

/** Net bracket depth a line opens (negative when it closes more than it opens). */
function bracketDelta(line: string): number {
  return (
    (line.match(/[{[]/g)?.length ?? 0) - (line.match(/[}\]]/g)?.length ?? 0)
  );
}

/**
 * The first line of a crash dump that reads as a human explanation.
 *
 * Node prints the error's own properties as a brace block under the stack
 * (`{ code: 'MODULE_NOT_FOUND', requireStack: [ '/app/…' ] }`). Skipping only
 * the opening brace would leave its inner lines as candidates, so the block is
 * skipped whole by depth.
 *
 * A block opens ONLY on a line that starts with `{`, which is how Node prints
 * it. Counting brackets on every line instead let a stray `[` in prose — or
 * the truncated JSON the HTTP adapter's body preview can emit — open a block
 * that never closed, swallowing the real sentence underneath it.
 */
function findMeaningfulLine(text: string): string | undefined {
  const lines = text.split("\n").map((line) => line.trim());

  let depth = 0;
  let endedInsideBlock = false;
  for (const line of lines) {
    if (depth > 0) {
      depth = Math.max(0, depth + bracketDelta(line));
      endedInsideBlock = depth > 0;
      continue;
    }
    if (line.startsWith("{")) {
      depth = Math.max(0, bracketDelta(line));
      endedInsideBlock = depth > 0;
      continue;
    }
    if (line.length === 0 || isNoiseLine(line)) continue;
    return line;
  }

  // A block that never closed ate the rest of the dump. That happens for real:
  // the HTTP adapter truncates response bodies mid-string, so unbalanced JSON
  // arrives as a matter of course. Rescan without depth — still skipping lines
  // that open an object, so a balanced block's innards can't surface — rather
  // than lose a genuine sentence sitting under the truncation.
  if (!endedInsideBlock) return undefined;
  return lines.find(
    (line) => line.length > 0 && !line.startsWith("{") && !isNoiseLine(line),
  );
}

/**
 * Where an HTML error document starts inside an otherwise-prose line. The
 * HTTP adapter appends the upstream's response body after its own prose
 * (`HTTP 502: … (request-id: …): <body>`), so a gateway's HTML error page
 * lands mid-line. Only the unambiguous document openers match — a bare `<`
 * also appears in legitimate prose like `expected <value>`.
 */
const HTML_DOCUMENT_MARKER = /<!doctype\s+html|<html[\s>]/i;

/**
 * Collapse a raw error blob (often a multi-line child-process dump) into a
 * single concise line: strip the "Child process exited with code N:" wrapper
 * and any runtime noise, keep the first meaningful line, drop an inline HTML
 * error document, and cap the length.
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
  let collapsed = meaningful.replace(/\s+/g, " ").trim();
  const markupStart = collapsed.search(HTML_DOCUMENT_MARKER);
  if (markupStart >= 0) {
    // The prose before the document (status, URL, request id) is all the
    // customer's own data and stays; the page itself never reads as a reason.
    collapsed = collapsed.slice(0, markupStart).trimEnd();
  }
  if (collapsed.length === 0) return undefined;
  if (collapsed.length <= MAX_GENERIC_MESSAGE_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_GENERIC_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

/** Markers of a connection that failed outright (refused / DNS / reset / undici fetch). */
const NETWORK_UNREACHABLE_NEEDLES = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "fetch failed",
  "network error",
  // Name resolution, in the two shapes it reaches us: Node prefixes every
  // resolver failure with the syscall, and curl-style clients print prose
  // instead of an errno. Both mean the same thing as ENOTFOUND, which only
  // covers one of the errno values a resolver can return.
  "getaddrinfo",
  "could not resolve hostname",
] as const;

/**
 * What a Cloudflare quick tunnel returns once its local `cloudflared` process
 * has ended: the edge still resolves the hostname but answers HTTP 530 with
 * Cloudflare's "error code: 1033" (tunnel error) body.
 */
const TUNNEL_GONE_NEEDLES = ["HTTP 530", "error code: 1033"] as const;

/**
 * True when the raw text carries BOTH Cloudflare markers. Requiring both is
 * what makes the signal unambiguous: an origin can answer 530 for its own
 * reasons, and "1033" can appear in an ordinary payload, but only the
 * Cloudflare edge answers 530 with the 1033 tunnel-error body.
 */
function isTunnelGoneFailure(text: string): boolean {
  return TUNNEL_GONE_NEEDLES.every((needle) => contains(text, needle));
}

/**
 * True when a raw run failure is transport-level: the connection itself
 * failed (or the tunnel edge reported its origin gone) rather than the target
 * rejecting the request. This is the gate for naming a failure a dead dev
 * tunnel: the caller supplies the "target has a devTunnel" fact, this module
 * supplies the "the failure looks like the tunnel is gone" half.
 */
export function isTransportLevelScenarioFailure(
  raw: string | undefined,
): boolean {
  const text = (raw ?? "").trim();
  if (text.length === 0) return false;
  return (
    NETWORK_UNREACHABLE_NEEDLES.some((needle) => contains(text, needle)) ||
    isTunnelGoneFailure(text)
  );
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

/** Markers that only an uncaught Node crash prints. */
const NODE_CRASH_MARKERS = [
  "node:internal/modules",
  "Require stack:",
  "at Module._",
] as const;

/**
 * The wrapper `scenario.processor.ts` puts on a child that exited non-zero
 * WITHOUT reporting a structured error — which is exactly the case where our
 * own runner died before it could say anything. When the runner does report
 * (an adapter failure, a judge error), its own text is used and this wrapper
 * never appears.
 */
const CHILD_EXIT_WRAPPER = /Child process exited with code \d+/i;

/**
 * True when OUR runner process died in Node's module loader.
 *
 * Both halves are load-bearing. A Node crash dump says a Node process failed
 * to load something, not WHICH process: `http-agent.adapter.ts` embeds the
 * customer's HTTP response body verbatim in the error it throws, so a customer
 * agent that boots with its own `Cannot find module` — stack frames,
 * `Require stack:` and all — reaches this classifier looking identical.
 * Claiming "the fault is on our side" for their missing dependency would send
 * them looking in the wrong place, so the crash must ALSO carry the wrapper
 * only our own dead child gets.
 */
function isOurRunnerCrash(text: string): boolean {
  return (
    CHILD_EXIT_WRAPPER.test(text) &&
    NODE_CRASH_MARKERS.some((marker) => contains(text, marker))
  );
}

/**
 * Classification rules, ordered most-specific-first: a TLS cert failure is more
 * actionable than the generic "fetch failed" it usually rides on, so it wins.
 */
/** `Connected agent call failed (<code>): <message>`, split. */
const CONNECTED_CALL_FAILURE =
  /Connected agent call failed \(([a-z_0-9]+)\):\s*([^\n]*)/;

/** The connected agent codes a run can fail with, and their copy. */
const CONNECTED_AGENT_ENVELOPES: Record<
  string,
  { code: ScenarioInfraErrorCode; message: string; hint: string }
> = {
  agent_offline: {
    code: ScenarioInfraErrorCode.AgentOffline,
    message: "No process running the connected agent is connected.",
    hint: "Start the process that runs the decorated function, then run again.",
  },
  agent_call_timeout: {
    code: ScenarioInfraErrorCode.AgentCallTimeout,
    message:
      "The connected agent did not answer a turn before its call budget.",
    hint: "Check the process for slow work, or raise the timeout on the decorated function.",
  },
  agent_call_failed: {
    code: ScenarioInfraErrorCode.AgentCallFailed,
    message: "The connected agent raised an error on a turn.",
    hint: "The process logs carry the stack of the error the function raised.",
  },
  agent_disconnected: {
    code: ScenarioInfraErrorCode.AgentDisconnected,
    message:
      "The connected agent instance disconnected while it was working on a turn.",
    hint: "Start the process again, then run again. The turn was not sent twice.",
  },
  agent_instance_lost: {
    code: ScenarioInfraErrorCode.AgentInstanceLost,
    message:
      "The instance this conversation was pinned to is no longer connected.",
    hint: "Start the process again, then run again, or turn off sticky on the decorated function.",
  },
  agent_busy: {
    code: ScenarioInfraErrorCode.AgentBusy,
    message:
      "Every instance of the connected agent stayed busy for the whole retry budget.",
    hint: "Raise the concurrency on the decorated function, or connect more instances.",
  },
};

function connectedAgentRules(): ClassificationRule[] {
  return Object.entries(CONNECTED_AGENT_ENVELOPES).map(([code, envelope]) => ({
    needles: [`Connected agent call failed (${code})`],
    build: (text) => {
      const remote = CONNECTED_CALL_FAILURE.exec(text)?.[2]?.trim();
      // The function's own error is the whole point of agent_call_failed;
      // for the other codes the relay's sentence and ours say the same thing.
      const message =
        code === "agent_call_failed" && remote
          ? `The connected agent raised: ${remote.slice(0, MAX_GENERIC_MESSAGE_LENGTH)}`
          : envelope.message;
      return { code: envelope.code, message, hint: envelope.hint };
    },
  }));
}

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
    alsoRequires: isOurRunnerCrash,
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
  // Connected agent failures. The child's adapter writes
  // `Connected agent call failed (<code>): <message>`, so the code between
  // the brackets is the classification and the message after it is what the
  // customer reads: the relay's own sentence, or the function's own error.
  ...connectedAgentRules(),
  {
    // A Cloudflare quick tunnel whose local `cloudflared` process ended: the
    // edge answers HTTP 530 with the "error code: 1033" body. Named here,
    // without any devTunnel config lookup, so failures the scenario SDK
    // records itself (which never pass through the failure handler) still
    // read as a dead tunnel instead of a generic error carrying raw HTML.
    needles: ["HTTP 530"],
    alsoRequires: isTunnelGoneFailure,
    build: () => ({
      code: ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
      message:
        "The agent points at a local development tunnel that is no longer " +
        "responding. The `langwatch agent dev` session that created it has " +
        "probably ended.",
      hint: "Run `langwatch agent dev` again on the machine that started the tunnel, or restore the agent's URL in its settings.",
    }),
  },
  {
    // Network unreachable (connection refused / DNS / reset / undici fetch).
    needles: [...NETWORK_UNREACHABLE_NEEDLES],
    build: (text) => {
      const host = targetHostFromTransportError(text);
      return {
        code: ScenarioInfraErrorCode.PlatformUnreachable,
        message: host
          ? `Couldn't reach the agent target ${host} while running the simulation.`
          : "Couldn't reach the endpoint while running the simulation.",
        hint: "Check that the target service is running and reachable from LangWatch.",
      };
    },
  },
];

/**
 * The target host named by an HTTP agent transport error, when the raw text
 * is one. Knowing which target failed is most of what makes the message
 * actionable, so it is carried through to the customer-facing copy; anything
 * else classifies without a host and keeps the generic sentence.
 */
function targetHostFromTransportError(text: string): string | undefined {
  return /HTTP agent target (\S+) could not be reached/.exec(text)?.[1];
}

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
    const hasMatchingNeedle = rule.needles.some((needle) =>
      contains(text, needle),
    );
    if (hasMatchingNeedle && (rule.alsoRequires?.(text) ?? true)) {
      return rule.build(text);
    }
  }

  return {
    code: ScenarioInfraErrorCode.Infra,
    message: summarize(text) ?? UNREADABLE_FAILURE_MESSAGE,
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
    case ScenarioInfraErrorCode.AgentDevTunnelUnreachable:
      return "Local tunnel not responding";
    case ScenarioInfraErrorCode.AgentOffline:
      return "Connected agent not running";
    case ScenarioInfraErrorCode.AgentCallTimeout:
      return "Connected agent did not answer in time";
    case ScenarioInfraErrorCode.AgentCallFailed:
      return "Connected agent raised an error";
    case ScenarioInfraErrorCode.AgentDisconnected:
      return "Connected agent disconnected";
    case ScenarioInfraErrorCode.AgentInstanceLost:
      return "Pinned instance is gone";
    case ScenarioInfraErrorCode.AgentBusy:
      return "Connected agent busy";
    case ScenarioInfraErrorCode.Infra:
      return "Simulation failed";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
