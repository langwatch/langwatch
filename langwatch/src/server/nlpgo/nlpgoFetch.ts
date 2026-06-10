import { lambdaFetch } from "../../utils/lambdaFetch";
import { getProjectLambdaArn } from "../../optimization_studio/server/lambda";

/**
 * Origin tag for the X-LangWatch-Origin header. Set at the request
 * boundary by the call site so every span downstream (nlpgo + gateway)
 * inherits a consistent attribution. See specs/nlp-go/telemetry.feature.
 */
export type NLPOrigin =
  | "workflow"
  | "playground"
  | "evaluation"
  | "scenario"
  | "topic_clustering";

const TRACE_ID_HEX_RE = /^[0-9a-fA-F]{32}$/;
const SPAN_ID_HEX_RE = /^[0-9a-fA-F]{16}$/;

/**
 * Format a W3C `traceparent` header value. Validates that traceId and
 * parentSpanId are well-formed hex; throws on malformed input rather
 * than silently emitting a broken header (silent breakage = orphan
 * traces in prod, the exact failure mode we're fixing).
 *
 * The `sampled` flag defaults to true because every existing caller
 * is in the evaluator chain, where we always want to record. If a
 * future caller is propagating from a non-sampled inbound trace, it
 * MUST pass `sampled: false` so we don't force-sample downstream.
 *
 * Exported for unit tests.
 */
export function formatTraceparent(
  parent: {
    traceId: string;
    parentSpanId: string;
  },
  options: { sampled?: boolean } = {},
): string {
  if (!TRACE_ID_HEX_RE.test(parent.traceId)) {
    throw new Error(
      `nlpgoFetch.formatTraceparent: invalid traceId (need 32 hex chars), got: ${JSON.stringify(parent.traceId)}`,
    );
  }
  if (!SPAN_ID_HEX_RE.test(parent.parentSpanId)) {
    throw new Error(
      `nlpgoFetch.formatTraceparent: invalid parentSpanId (need 16 hex chars), got: ${JSON.stringify(parent.parentSpanId)}`,
    );
  }
  const flags = options.sampled === false ? "00" : "01";
  return `00-${parent.traceId.toLowerCase()}-${parent.parentSpanId.toLowerCase()}-${flags}`;
}

export interface NLPGOFetchOptions<TBody = unknown> {
  /** projectId is the distinct_id used for the per-project flag rollout. */
  projectId: string;
  /** Path under the NLP service, e.g. "/studio/execute_sync". The Go path
   *  prefix `/go` is added automatically when the flag is on. */
  path: string;
  /** Request body to JSON-stringify. */
  body: TBody;
  /** Tag the request as one of the canonical origins; sent as
   *  X-LangWatch-Origin so spans downstream are attributable. */
  origin: NLPOrigin;
  /** Optional organization scope for PostHog group targeting. */
  organizationId?: string;
  /**
   * Causality depth of the *caller*. nlpgo increments by 1 and stamps
   * the result on every span it emits. The reactor in trace-processing
   * skips dispatching evaluations on spans where depth >= 1, breaking
   * the eval-of-eval loop. See
   * specs/monitors/online-evaluator-loop-prevention.feature.
   *
   * 0 (or absent) means "this call originates from non-evaluator code"
   * (eg. user-triggered Studio run). The receiver always emits depth=1
   * on its spans in that case.
   */
  causalityDepth?: number;
  /**
   * Parent trace context for W3C `traceparent` propagation. When set,
   * nlpgo's spans inherit `traceId` so the eval workflow appears as
   * a child sub-tree of the parent trace in Studio's waterfall view
   * instead of landing on a separate trace.
   *
   * Without this, nlpgo's `applyInboundCausality` finds no traceparent
   * header, `startStudioSpan` falls through to a fresh trace, and
   * eval spans become orphans of the original trace they evaluate.
   * This is exactly the bug rchaves caught in prod on 2026-05-14
   * (eval ran, spans emitted, but landed on a new trace_id).
   *
   * `parentSpanId` is the 16-hex span_id the eval root span should
   * link to as its parent. Callers should pass the root span_id of
   * the parent trace so the waterfall renders cleanly; a synthesized
   * value still gives trace_id continuity but loses the linkage UI.
   */
  parentTrace?: {
    traceId: string;
    parentSpanId: string;
  };
}

export interface NLPGOFetchResult<T> {
  ok: boolean;
  status: number;
  statusText: string;
  /** Always "go" — nlpgo is the only engine. Retained for span attribution. */
  enginePath: "go";
  json: () => Promise<T>;
  text: () => Promise<string>;
}

/**
 * Send a request to the nlpgo service. nlpgo serves the Go engine under
 * the `/go` prefix, so the caller's `path` (e.g. "/studio/execute_sync")
 * is rewritten to "/go/studio/execute_sync" and tagged with
 * X-LangWatch-Origin. There is no auth on this hop: the TS app and nlpgo
 * share the Lambda function URL boundary.
 *
 * Topic clustering runs on langevals, not nlpgo, so it MUST NOT call this
 * helper (see topicClustering.ts).
 */
export async function nlpgoFetch<T = unknown>(
  opts: NLPGOFetchOptions,
): Promise<NLPGOFetchResult<T>> {
  const finalPath = "/go" + opts.path;
  const bodyStr = JSON.stringify(opts.body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-LangWatch-Origin": opts.origin,
  };

  // Causality depth: forwarded to nlpgo only when the caller is part of
  // an evaluator chain (i.e. opts.causalityDepth is explicitly set, even
  // to 0). When undefined we DO NOT send the header — otherwise nlpgo
  // would stamp depth>=1 on every non-evaluator workflow run (playground,
  // scenarios, customer workflow API), silently blocking ON_MESSAGE
  // monitors from firing on workflow-produced traces.
  if (opts.causalityDepth !== undefined) {
    const callerDepth = Math.max(0, Math.floor(opts.causalityDepth));
    headers["X-LangWatch-Causality-Depth"] = String(callerDepth);
  }

  // W3C traceparent — makes the receiving service's spans inherit our
  // trace_id and parent_span_id. Without this header, nlpgo creates a
  // new trace_id for the evaluation, breaking the parent-child link
  // (the 2026-05-14 orphan-trace bug rchaves caught in prod).
  // Format: 00-<32-hex traceId>-<16-hex parentSpanId>-<flags>
  if (opts.parentTrace) {
    headers["traceparent"] = formatTraceparent(opts.parentTrace);
  }

  const functionArn = process.env.LANGWATCH_NLP_LAMBDA_CONFIG
    ? await getProjectLambdaArn(opts.projectId)
    : process.env.LANGWATCH_NLP_SERVICE!;

  const response = await lambdaFetch<T>(functionArn, finalPath, {
    method: "POST",
    headers,
    body: bodyStr,
    // Scopes S3 staging when the body is too large for the 6 MiB Lambda
    // sync-invoke Payload cap (per-project ARN path only; no-op for the
    // self-hosted HTTP URL path).
    projectId: opts.projectId,
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    enginePath: "go",
    json: response.json,
    text: response.text,
  };
}

/**
 * Return the OpenAI-compatible proxy base URL for the playground +
 * modelProviders surface: `${baseURL}/go/proxy/v1` — the Go playground
 * proxy (in-process dispatcher, real AI Gateway, no LiteLLM).
 *
 * On the wire: x-litellm-* credential headers + OpenAI-shape body, parsed
 * by gatewayproxy/headers.go and forwarded to the gateway dispatcher.
 */
export function nlpgoProxyBaseURL(opts: { baseURL: string }): string {
  const trimmed = opts.baseURL.replace(/\/$/, "");
  return `${trimmed}/go/proxy/v1`;
}
