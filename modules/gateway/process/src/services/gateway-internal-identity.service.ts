import { timingSafeEqual } from "node:crypto";

import type { RestIdentity, RestCaller } from "@langwatch/api/rest";
import {
  GatewayInternalAuthenticationError,
  GatewayInternalAuthenticationUnavailableError,
} from "@langwatch/gateway-contract";
import { nowInstant } from "@langwatch/time";

import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
  GATEWAY_SIGNATURE_WINDOW_SECONDS,
} from "../rules/gateway-internal-identity.rules.ts";
import { GatewayAuthDecisionService } from "./gateway-auth-decision.service.ts";

/**
 * This family's gate travels with the declaration since a published control
 * plane can't change what a deployed Go gateway demands. HMAC checked before
 * timestamp (avoids a timing channel); an unset secret 500s, never admits all.
 */
export class GatewayInternalIdentityService implements RestIdentity {
  readonly #secret: string | undefined;
  private constructor(
    secret: string | undefined,
    private readonly decisions: GatewayAuthDecisionService,
  ) {
    this.#secret = secret;
  }
  static create({
    secret,
    decisions = GatewayAuthDecisionService.create(),
  }: {
    secret: string | undefined;
    decisions?: GatewayAuthDecisionService;
  }): GatewayInternalIdentityService {
    return new GatewayInternalIdentityService(secret, decisions);
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
      this.decisions.record({ request, code: "gateway_internal_secret_missing", status: 500 });
      throw new GatewayInternalAuthenticationUnavailableError();
    }

    const presentedSig = request.headers.get("X-LangWatch-Gateway-Signature");
    const presentedTs = request.headers.get("X-LangWatch-Gateway-Timestamp");
    if (!presentedSig || !presentedTs) {
      this.decisions.record({
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
      this.decisions.record({ request, code: "invalid_signature", status: 401 });

      throw new GatewayInternalAuthenticationError("invalid_signature", "signature mismatch");
    }

    const ts = Number.parseInt(presentedTs, 10);
    if (!Number.isFinite(ts)) {
      this.decisions.record({
        request,
        code: "invalid_timestamp",
        status: 401,
        detail: { presentedTs },
      });

      throw new GatewayInternalAuthenticationError(
        "invalid_timestamp",
        "X-LangWatch-Gateway-Timestamp must be unix seconds",
      );
    }

    const now = Math.floor(nowInstant().epochMilliseconds / 1000);
    if (Math.abs(now - ts) > GATEWAY_SIGNATURE_WINDOW_SECONDS) {
      this.decisions.record({
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
