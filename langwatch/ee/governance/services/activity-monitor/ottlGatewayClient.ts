// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Thin HTTP client for the aigateway's OTTL endpoints.
 *
 * The aigateway (services/aigateway/) embeds `pkg/ottl` from the
 * upstream OpenTelemetry Collector — we don't re-implement OTTL in
 * TypeScript (rchaves directive: "official otel typescript library
 * is fine, embedded Go is fine, non-official random GitHub dev lib
 * is not fine"). The control plane proxies validation + transform
 * requests over the existing HMAC-signed `/internal/*` channel.
 *
 * Two endpoints (locked with @sergey_2):
 *
 *   POST /internal/validate-ottl
 *     body: { statements: string[] }
 *     200:  { ok: true }
 *          | { ok: false, errors: { statement_index, line, col, message }[] }
 *
 *   POST /internal/transform
 *     body: { source_id, kind: "log" | "metric",
 *             encoding: "proto" | "json",
 *             payload_b64, statements: string[] }
 *     200:  { ok: true, payload_b64, encoding }
 *          | { ok: false, errors: { statement_index, line, col, message }[] }
 *
 *   `encoding` is forwarded to the gateway so pdata can pick the right
 *   unmarshaller — Claude Code's OTLP/HTTP exporter sends JSON; other
 *   sources may send protobuf. Sergey 2026-05-06 contract widening
 *   (originally proto-only).
 *
 * Spec: specs/ai-governance/ingestion-sources/claude-code-otlp.feature
 */

import { createHash, createHmac } from "crypto";

import { env } from "~/env.mjs";

export interface OttlValidationError {
  statementIndex: number;
  line: number;
  col: number;
  message: string;
}

/**
 * Why the check didn't run. Both are infrastructure states, not verdicts on
 * the admin's statements.
 */
export type OttlValidationDeferredReason =
  /** No `LW_GATEWAY_INTERNAL_URL` / secret — the dev fast-path. */
  | "gateway_unconfigured"
  /** Gateway is up but this build doesn't ship `/internal/validate-ottl`. */
  | "endpoint_unavailable";

/**
 * Three outcomes, not two.
 *
 * `deferred` is the one that was missing. The two soft-fallback paths below
 * (gateway unreachable, endpoint 404) used to return `{ ok: true }`, which is
 * indistinguishable from a real pass — so the editor painted a green "valid"
 * dot on every line for statements nothing had looked at, on the two most
 * common failure paths. The discriminant is `status` rather than a boolean
 * precisely so no caller can spell "we didn't look" as truthy.
 */
export type OttlValidationResult =
  | { status: "valid" }
  | { status: "invalid"; errors: OttlValidationError[] }
  | { status: "deferred"; reason: OttlValidationDeferredReason };

export type OttlEncoding = "proto" | "json";

export type OttlTransformResult =
  | { ok: true; payloadB64: string; encoding: OttlEncoding }
  | { ok: false; errors: OttlValidationError[] };

interface RawValidateResponse {
  ok: boolean;
  errors?: Array<{
    statement_index?: number;
    line?: number;
    col?: number;
    message?: string;
  }>;
}

interface RawTransformResponse {
  ok: boolean;
  payload_b64?: string;
  encoding?: OttlEncoding;
  /** Backward-compat: original sergey contract used `payload_proto_b64`.
   *  Read either field, but prefer `payload_b64`. */
  payload_proto_b64?: string;
  errors?: Array<{
    statement_index?: number;
    line?: number;
    col?: number;
    message?: string;
  }>;
}

class OttlGatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OttlGatewayUnavailableError";
  }
}

/**
 * Compose the canonical signing string used by the gateway-internal
 * channel:
 *   METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
 *
 * Mirrors `buildGatewayCanonicalString` in
 * `src/server/routes/gateway-internal.ts`. Imported via duplication
 * rather than cross-package import — that file lives under `src/` and
 * pulls in Hono context types we don't want in this lightweight EE
 * service module.
 */
function canonical(
  method: string,
  path: string,
  timestamp: string,
  body: string,
): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `${method}\n${path}\n${timestamp}\n${bodyHash}`;
}

function sign(secret: string, canonicalString: string): string {
  return createHmac("sha256", secret).update(canonicalString).digest("hex");
}

/**
 * Internal-URL resolution for the control-plane → gateway HMAC channel.
 *
 * `LW_GATEWAY_INTERNAL_URL` is the canonical name for "where this
 * control plane reaches the gateway's /internal/* surface". It exists
 * specifically because the older `LW_GATEWAY_BASE_URL` is overloaded:
 * the Go gateway re-uses that exact name for the OPPOSITE direction
 * (gateway → control-plane), and both processes source the same
 * `langwatch/.env`, so dev would always have one of them wrong.
 *
 * Resolution order — prefer the new name, fall back to the old:
 *   1. LW_GATEWAY_INTERNAL_URL  (canonical, defaults to :5563 in dev)
 *   2. LW_GATEWAY_BASE_URL      (legacy fallback — keeps SaaS working
 *                                where TF sets only the old name)
 */
function resolveBaseUrl(): string | null {
  return (
    env.LW_GATEWAY_INTERNAL_URL ??
    process.env.LW_GATEWAY_INTERNAL_URL ??
    env.LW_GATEWAY_BASE_URL ??
    process.env.LW_GATEWAY_BASE_URL ??
    null
  );
}

function resolveSecret(): string | null {
  return (
    env.LW_GATEWAY_INTERNAL_SECRET ??
    process.env.LW_GATEWAY_INTERNAL_SECRET ??
    null
  );
}

function normaliseErrors(
  raw: RawValidateResponse | RawTransformResponse,
): OttlValidationError[] {
  return (raw.errors ?? []).map((e, idx) => ({
    statementIndex: e.statement_index ?? idx,
    line: e.line ?? 0,
    col: e.col ?? 0,
    message: e.message ?? "OTTL validation failed",
  }));
}

async function postSigned(path: string, body: unknown): Promise<Response> {
  const baseUrl = resolveBaseUrl();
  const secret = resolveSecret();
  if (!baseUrl || !secret) {
    throw new OttlGatewayUnavailableError(
      "LW_GATEWAY_INTERNAL_URL (or legacy LW_GATEWAY_BASE_URL) and LW_GATEWAY_INTERNAL_SECRET must both be set for OTTL endpoints",
    );
  }
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyJson = JSON.stringify(body);
  const sig = sign(secret, canonical("POST", path, ts, bodyJson));
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  return await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": sig,
      "X-LangWatch-Gateway-Timestamp": ts,
      "X-LangWatch-Gateway-Node": "control-plane",
    },
    body: bodyJson,
  });
}

/**
 * Validate a list of OTTL statements server-side.
 *
 * When the gateway isn't reachable (dev fast-path before
 * `make service svc=aigateway`) or is up without the endpoint, the check does
 * not run and the result is `deferred` — never `valid`. The composer still
 * doesn't block on infrastructure that's only required at runtime, but it can
 * no longer tell the admin their statements passed a check that never
 * happened. Real syntax errors still surface only once the gateway is up.
 */
export async function validateOttlStatements(
  statements: string[],
): Promise<OttlValidationResult> {
  let res: Response;
  try {
    res = await postSigned("/internal/validate-ottl", { statements });
  } catch (err) {
    if (err instanceof OttlGatewayUnavailableError) {
      return { status: "deferred", reason: "gateway_unconfigured" };
    }
    throw err;
  }
  if (res.status === 404) {
    // Gateway up, but binary doesn't yet ship the endpoint (Sergey's
    // pkg/ottl integration not deployed to this stack). Deferred, which is
    // neither "all statements invalid" nor "all statements fine".
    return { status: "deferred", reason: "endpoint_unavailable" };
  }
  if (!res.ok) {
    throw new Error(`OTTL validate failed: ${res.status} ${await res.text()}`);
  }
  const raw = (await res.json()) as RawValidateResponse;
  if (raw.ok) return { status: "valid" };
  return { status: "invalid", errors: normaliseErrors(raw) };
}

/**
 * Run a list of OTTL statements over an OTLP proto payload, returning
 * the mutated payload as base64. Used by the OTLP receiver path
 * before the canonical extractor reads `langwatch.*` attributes.
 *
 * Throws (rather than ok-true falling back) when the gateway is
 * unreachable — the caller decides whether to drop to a legacy
 * extractor (eg. claude_code's hardcoded pre-OTTL reader) or 503 the
 * receive. Validation falls back gracefully; transform must not.
 */
export async function transformOttlPayload(input: {
  sourceId: string;
  kind: "log" | "metric";
  encoding: OttlEncoding;
  payloadB64: string;
  statements: string[];
}): Promise<OttlTransformResult> {
  const res = await postSigned("/internal/transform", {
    source_id: input.sourceId,
    kind: input.kind,
    encoding: input.encoding,
    payload_b64: input.payloadB64,
    // Send under the legacy field name too while sergey's contract
    // widening rolls out — keeps either build of the gateway working.
    payload_proto_b64: input.payloadB64,
    statements: input.statements,
  });
  if (!res.ok) {
    throw new Error(`OTTL transform failed: ${res.status} ${await res.text()}`);
  }
  const raw = (await res.json()) as RawTransformResponse;
  if (raw.ok) {
    const payloadB64 = raw.payload_b64 ?? raw.payload_proto_b64;
    if (payloadB64) {
      return {
        ok: true,
        payloadB64,
        encoding: raw.encoding ?? input.encoding,
      };
    }
  }
  return { ok: false, errors: normaliseErrors(raw) };
}

export { OttlGatewayUnavailableError };
