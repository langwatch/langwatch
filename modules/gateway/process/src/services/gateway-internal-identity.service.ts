import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { RestIdentity, RestCaller } from "@langwatch/api/rest";
import {
  GatewayInternalAuthenticationError,
  GatewayInternalAuthenticationUnavailableError,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:gateway-internal");

export const GATEWAY_SIGNATURE_WINDOW_SECONDS = 300;

/**
 * Build the canonical string the Go gateway signs:
 *   METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
 */
export function buildGatewayCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");

  return `${input.method}\n${input.path}\n${input.timestamp}\n${bodyHash}`;
}

/** hex(hmac_sha256(secret, canonical)) */
export function computeGatewaySignature(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function logAuthDecision({
  request,
  code,
  status,
  detail,
}: {
  request: Request | string | undefined;
  code: string;
  status: number;
  detail?: Record<string, unknown>;
}): void {
  logger.warn(
    {
      code,
      status,
      path:
        request instanceof Request
          ? new URL(request.url).pathname
          : "/api/internal/gateway/resolve-key",
      gatewayNodeId:
        (request instanceof Request ? request.headers.get("X-LangWatch-Gateway-Node") : request) ??
        null,
      ...detail,
    },
    `gateway-internal auth: ${code}`,
  );
}

/**
 * This family's gate travels with the declaration since a published control
 * plane can't change what a deployed Go gateway demands. HMAC checked before
 * timestamp (avoids a timing channel); an unset secret 500s, never admits all.
 */
export class GatewayInternalIdentity implements RestIdentity {
  readonly #secret: string | undefined;
  private constructor(secret: string | undefined) {
    this.#secret = secret;
  }
  static create(secret: string | undefined): GatewayInternalIdentity {
    return new GatewayInternalIdentity(secret);
  }
  authenticate(): never {
    throw new GatewayInternalAuthenticationError(
      "invalid_signature",
      "A gateway request requires its signed internal door",
    );
  }
  identify({ request, rawBody }: { request: Request; rawBody?: string | Uint8Array }): RestCaller {
    const secret = this.#secret;
    if (!secret) {
      logAuthDecision({ request, code: "gateway_internal_secret_missing", status: 500 });
      throw new GatewayInternalAuthenticationUnavailableError();
    }

    const presentedSig = request.headers.get("X-LangWatch-Gateway-Signature");
    const presentedTs = request.headers.get("X-LangWatch-Gateway-Timestamp");
    if (!presentedSig || !presentedTs) {
      logAuthDecision({
        request,
        code: "missing_signature",
        status: 401,
        detail: {
          hasSignature: Boolean(presentedSig),
          hasTimestamp: Boolean(presentedTs),
        },
      });

      throw new GatewayInternalAuthenticationError(
        "missing_signature",
        "X-LangWatch-Gateway-Signature and X-LangWatch-Gateway-Timestamp are required",
      );
    }

    const body = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
    const url = new URL(request.url);
    const canonical = buildGatewayCanonicalString({
      method: request.method,
      path: url.pathname,
      timestamp: presentedTs,
      body,
    });
    const expected = computeGatewaySignature(secret, canonical);

    const a = Buffer.from(expected);
    const b = Buffer.from(presentedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      logAuthDecision({ request, code: "invalid_signature", status: 401 });

      throw new GatewayInternalAuthenticationError("invalid_signature", "signature mismatch");
    }

    const ts = Number.parseInt(presentedTs, 10);
    if (!Number.isFinite(ts)) {
      logAuthDecision({ request, code: "invalid_timestamp", status: 401, detail: { presentedTs } });

      throw new GatewayInternalAuthenticationError(
        "invalid_timestamp",
        "X-LangWatch-Gateway-Timestamp must be unix seconds",
      );
    }

    const now = Math.floor(nowInstant().epochMilliseconds / 1000);
    if (Math.abs(now - ts) > GATEWAY_SIGNATURE_WINDOW_SECONDS) {
      logAuthDecision({
        request,
        code: "timestamp_out_of_window",
        status: 401,
        detail: { driftSeconds: now - ts },
      });

      throw new GatewayInternalAuthenticationError(
        "timestamp_out_of_window",
        `timestamp drift > ${GATEWAY_SIGNATURE_WINDOW_SECONDS}s`,
      );
    }

    return {
      actor: null,
      scope: null,
      internal: { type: "internalSecret", secretName: "gateway-internal" },
    };
  }
}
