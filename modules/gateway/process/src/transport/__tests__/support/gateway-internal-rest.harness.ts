/**
 * The `/api/internal/gateway` family on a runtime standing in for the
 * process: no framework credential, the family's own HMAC gate, the Go
 * plane's error envelope. Unsupplied members throw, naming what was asked.
 */
import { apiErrorBody, createRestRuntime } from "@langwatch/api/rest";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
  GatewayInternalIdentity,
} from "../../../services/gateway-internal-identity.service.ts";
import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
} from "../../../services/gateway-internal-protocol.service.ts";
import { gatewayInternalRest } from "../../gateway-internal.rest.ts";

/**
 * Sequential-hex HMAC fixture, not a credential; allowlisted by path in
 * .gitleaks.toml.
 */
export const GATEWAY_INTERNAL_TEST_SECRET = "0123456789abcdef0123456789abcdef";

/** The process boundary's handled-error envelope, with an explicit unexpected fallback. */
const renderUnexpected: ErrorHandler = (error, c) => {
  if (!HandledError.isHandled(error)) {
    return c.json({ type: "internal_error", code: "internal_error", message: String(error) }, 500);
  }

  const status = error.httpStatus as ContentfulStatusCode;
  const internal = status >= 500;

  return c.json(
    apiErrorBody({
      status,
      code: internal ? "internal_error" : error.code,
      message: internal ? "An unknown error occurred" : error.message,
      meta: internal ? undefined : error.meta,
      retryable: error.retryable,
    }),
    status,
  );
};

/** Only what the test named; everything else says so by name. */
function suppliedMembers(
  members: Partial<GatewayInternalProtocolMembers>,
): GatewayInternalProtocolMembers {
  return new Proxy(members as GatewayInternalProtocolMembers, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);

      throw new Error(
        `the gateway-internal family reached "${String(property)}", which this test did not supply`,
      );
    },
  });
}

/** The family, mounted over the members a test supplies. */
export function mountGatewayInternalRest(
  members: Partial<GatewayInternalProtocolMembers>,
  options: { secret?: string | undefined } = {},
) {
  const secret = options.secret ?? GATEWAY_INTERNAL_TEST_SECRET;
  const protocol = GatewayInternalProtocolService.create(suppliedMembers(members));
  const app = createApiFixture<GatewayApi>(
    {
      findVirtualKeyBySecret: (secret) => protocol.findVirtualKeyBySecret(secret),
      findTraceDestination: (projectId) => protocol.findTraceDestination(projectId),
      signJwt: (input) => protocol.signJwt(input),
      touchVirtualKeyUsage: (id) => protocol.touchVirtualKeyUsage(id),
      refreshCodex: (input) => protocol.refreshCodex(input),
      findVirtualKeyForConfig: (id) => protocol.findVirtualKeyForConfig(id),
      configVersionToken: (input) => protocol.configVersionToken(input),
      materialiseConfig: (input) => protocol.materialiseConfig(input),
      listChanges: (organizationId, since, limit) =>
        protocol.listChanges(organizationId, since, limit),
      currentRevision: (organizationId) => protocol.currentRevision(organizationId),
      checkGuardrails: (input) => protocol.checkGuardrails(input),
      budgetBucketSpend: (input) => protocol.budgetBucketSpend(input),
      submitSpendCommands: (records) => protocol.submitSpendCommands(records),
      reserveRealtimeSession: (input) => protocol.reserveRealtimeSession(input),
      correlateRealtimeSession: (input) => protocol.correlateRealtimeSession(input),
      releaseRealtimeSession: (input) => protocol.releaseRealtimeSession(input),
      reportRealtimeSessionUsage: (input) => protocol.reportRealtimeSessionUsage(input),
    },
    "GatewayApi",
  );
  const runtime = createRestRuntime({
    identity: GatewayInternalIdentity.create(secret),
  });

  return runtime.mount(gatewayInternalRest.router(), {
    app: () => app,
    onError: renderUnexpected,
  });
}

/** One request signed the way the Go data plane signs it. */
export function signedGatewayRequest(input: {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  secret?: string;
}): Request {
  const secret = input.secret ?? GATEWAY_INTERNAL_TEST_SECRET;
  const body = input.body === undefined ? "" : JSON.stringify(input.body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const url = new URL(`http://api.test${input.path}`);
  const signature = computeGatewaySignature(
    secret,
    // The canonical string covers the PATH only — the query string is not
    // signed, which is what the data plane does and what the verifier reads.
    buildGatewayCanonicalString({ method: input.method, path: url.pathname, timestamp, body }),
  );

  return new Request(url, {
    method: input.method,
    ...(input.body === undefined ? {} : { body }),
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
      ...input.headers,
    },
  });
}
