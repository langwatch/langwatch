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
import {
  GovernanceOttlGateway,
  OttlGatewayUnavailableError,
  ottlTransformInputSchema,
  type OttlEncoding,
  type OttlTransformInput,
  type OttlTransformResult,
  type OttlValidationError,
  type OttlValidationResult,
} from "@langwatch/enterprise-governance-contract";

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
function canonical(method: string, path: string, timestamp: string, body: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `${method}\n${path}\n${timestamp}\n${bodyHash}`;
}

function sign(secret: string, canonicalString: string): string {
  return createHmac("sha256", secret).update(canonicalString).digest("hex");
}

function normaliseErrors(raw: RawValidateResponse | RawTransformResponse): OttlValidationError[] {
  return (raw.errors ?? []).map((e, idx) => ({
    statementIndex: e.statement_index ?? idx,
    line: e.line ?? 0,
    col: e.col ?? 0,
    message: e.message ?? "OTTL validation failed",
  }));
}

/**
 * App-owned HMAC client for the control-plane → gateway channel.
 *
 * `LW_GATEWAY_INTERNAL_URL` is the canonical name for "where this control
 * plane reaches the gateway's /internal/* surface". The older
 * `LW_GATEWAY_BASE_URL` is overloaded in the opposite direction and both
 * processes source the same `.env`, so configuration is resolved once by the
 * process composition root and injected here.
 */
export class AppGovernanceOttlGateway extends GovernanceOttlGateway {
  private constructor(
    private readonly baseUrl: string | null,
    private readonly secret: string | null,
    private readonly request: typeof fetch,
    private readonly now: () => number,
  ) {
    super();
  }

  static create(options: {
    baseUrl?: string | null;
    secret?: string | null;
    request?: typeof fetch;
    now?: () => number;
  }): AppGovernanceOttlGateway {
    return new AppGovernanceOttlGateway(
      options.baseUrl ?? null,
      options.secret ?? null,
      options.request ?? fetch,
      options.now ?? Date.now,
    );
  }

  async validate(statements: string[]): Promise<OttlValidationResult> {
    let response: Response;
    try {
      response = await this.postSigned("/internal/validate-ottl", {
        statements,
      });
    } catch (error) {
      if (error instanceof OttlGatewayUnavailableError) {
        return { status: "deferred", reason: "gateway_unconfigured" };
      }
      throw error;
    }
    if (response.status === 404) {
      return { status: "deferred", reason: "endpoint_unavailable" };
    }
    if (!response.ok) {
      throw new Error(`OTTL validate failed: ${response.status} ${await response.text()}`);
    }
    const raw = (await response.json()) as RawValidateResponse;
    return raw.ok ? { status: "valid" } : { status: "invalid", errors: normaliseErrors(raw) };
  }

  async transform(input: OttlTransformInput): Promise<OttlTransformResult> {
    const parsed = ottlTransformInputSchema.parse(input);
    const response = await this.postSigned("/internal/transform", {
      source_id: parsed.sourceId,
      kind: parsed.kind,
      encoding: parsed.encoding,
      payload_b64: parsed.payloadB64,
      payload_proto_b64: parsed.payloadB64,
      statements: parsed.statements,
    });
    if (!response.ok) {
      throw new Error(`OTTL transform failed: ${response.status} ${await response.text()}`);
    }
    const raw = (await response.json()) as RawTransformResponse;
    if (raw.ok) {
      const payloadB64 = raw.payload_b64 ?? raw.payload_proto_b64;
      if (payloadB64) {
        return {
          ok: true,
          payloadB64,
          encoding: raw.encoding ?? parsed.encoding,
        };
      }
    }
    return { ok: false, errors: normaliseErrors(raw) };
  }

  private async postSigned(path: string, body: unknown): Promise<Response> {
    if (!this.baseUrl || !this.secret) {
      throw new OttlGatewayUnavailableError(
        "LW_GATEWAY_INTERNAL_URL (or legacy LW_GATEWAY_BASE_URL) and LW_GATEWAY_INTERNAL_SECRET must both be set for OTTL endpoints",
      );
    }
    const timestamp = Math.floor(this.now() / 1_000).toString();
    const bodyJson = JSON.stringify(body);
    const signature = sign(this.secret, canonical("POST", path, timestamp, bodyJson));
    return await this.request(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LangWatch-Gateway-Signature": signature,
        "X-LangWatch-Gateway-Timestamp": timestamp,
        "X-LangWatch-Gateway-Node": "control-plane",
      },
      body: bodyJson,
    });
  }
}
