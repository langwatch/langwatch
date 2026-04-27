import { featureFlagService } from "../featureFlag/featureFlag.service";
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

/**
 * `release_nlp_go_engine_enabled` — gates whether traffic for a project
 * routes through the new Go path (`/go/*`) or stays on the legacy Python
 * path. Per-project rollout via PostHog. Topic clustering is intentionally
 * NOT gated by this flag (it stays on Python regardless).
 */
const NLP_GO_FLAG = "release_nlp_go_engine_enabled";

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
}

export interface NLPGOFetchResult<T> {
  ok: boolean;
  status: number;
  statusText: string;
  enginePath: "go" | "python";
  json: () => Promise<T>;
  text: () => Promise<string>;
}

/**
 * Send a request to the langwatch_nlp service, choosing between the new
 * Go engine path and the legacy Python path based on the
 * `release_nlp_go_engine_enabled` feature flag (per-project).
 *
 * When the flag is on:
 *  - the path is rewritten with the `/go` prefix
 *  - X-LangWatch-Origin is added with the call site's origin
 *
 * When off: existing behavior — POST to the legacy Python handler.
 * Bit-identical to today's traffic shape. There is no auth on this
 * hop — TS app and nlpgo share the Lambda function URL boundary, the
 * same posture today's Python NLP service uses.
 *
 * Topic clustering and other code paths that should stay on Python
 * regardless MUST NOT call this helper — they should keep using
 * `lambdaFetch` directly.
 */
export async function nlpgoFetch<T = unknown>(
  opts: NLPGOFetchOptions,
): Promise<NLPGOFetchResult<T>> {
  const goEnabled = await isNlpGoEnabled(opts);
  const enginePath: "go" | "python" = goEnabled ? "go" : "python";
  const finalPath = goEnabled ? "/go" + opts.path : opts.path;
  const bodyStr = JSON.stringify(opts.body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-LangWatch-Origin": opts.origin,
  };

  const functionArn = process.env.LANGWATCH_NLP_LAMBDA_CONFIG
    ? await getProjectLambdaArn(opts.projectId)
    : process.env.LANGWATCH_NLP_SERVICE!;

  const response = await lambdaFetch<T>(functionArn, finalPath, {
    method: "POST",
    headers,
    body: bodyStr,
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    enginePath,
    json: response.json,
    text: response.text,
  };
}

/**
 * Public read-only check for whether a project would route to the Go
 * engine. Used by:
 *   - the studio UI to hide the (now-defunct) Optimize button
 *   - the optimize REST endpoint to return 410
 *   - tRPC procedures that want to surface the engine choice to the UI
 */
export async function isNlpGoEnabled(
  opts: Pick<NLPGOFetchOptions, "projectId" | "organizationId">,
): Promise<boolean> {
  return featureFlagService.isEnabled(NLP_GO_FLAG, opts.projectId, false, {
    projectId: opts.projectId,
    organizationId: opts.organizationId,
  });
}

/**
 * Return the OpenAI-compatible proxy base URL for the playground +
 * modelProviders surface, gated on `release_nlp_go_engine_enabled`.
 *
 * - FF on  → `${LANGWATCH_NLP_SERVICE}/go/proxy/v1` (Go playground proxy:
 *   dispatcher in-process, real AI Gateway, no LiteLLM)
 * - FF off → `${LANGWATCH_NLP_SERVICE}/proxy/v1` (legacy LiteLLM proxy
 *   on the uvicorn child)
 *
 * On the wire shape stays bit-identical: x-litellm-* credential headers
 * + OpenAI-shape body. The Go side parses x-litellm-* via gatewayproxy/
 * headers.go and forwards to the gateway dispatcher; the Python side
 * keeps doing whatever LiteLLM does today. Customers don't see a
 * difference unless they've opted into the Go path.
 */
export async function nlpgoProxyBaseURL(opts: {
  projectId: string;
  baseURL: string;
  organizationId?: string;
}): Promise<string> {
  const goEnabled = await isNlpGoEnabled({
    projectId: opts.projectId,
    organizationId: opts.organizationId,
  });
  const trimmed = opts.baseURL.replace(/\/$/, "");
  return goEnabled ? `${trimmed}/go/proxy/v1` : `${trimmed}/proxy/v1`;
}
