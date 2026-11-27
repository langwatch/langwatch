/**
 * The `/api/internal/gateway` family on a runtime standing in for the
 * process: no framework credential, the family's own HMAC gate, the Go
 * plane's error envelope. Unsupplied members throw, naming what was asked.
 */
import { apiErrorBody, createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { gatewayInternalSignatureHeaders } from "@langwatch/process/gateway-internal-signature";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { GatewayInternalDoorService } from "../../../services/gateway-internal-door.service.ts";
import { GatewayInternalIdentityService } from "../../../services/gateway-internal-identity.service.ts";
import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
} from "../../../services/gateway-internal-protocol.service.ts";
import { type GatewayInternalDoorApi, gatewayInternalRest } from "../../gateway-internal.rest.ts";

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
  const door = GatewayInternalDoorService.create({ protocol });
  const app = createApiFixture<GatewayInternalDoorApi>(
    {
      answerInternalResolveKey: (input) => door.answerResolveKey(input),
      answerInternalCodexRefresh: (input) => door.answerCodexRefresh(input),
      answerInternalConfig: (input) => door.answerConfig(input),
      answerInternalChanges: (input) => door.answerChanges(input),
      answerInternalGuardrailCheck: (input) => door.answerGuardrailCheck(input),
      answerInternalBudgetBucketSpend: (input) => door.answerBudgetBucketSpend(input),
      answerInternalSpendCommands: (input) => door.answerSpendCommands(input),
      answerInternalReserveRealtimeSession: (input) => door.answerReserveRealtimeSession(input),
      answerInternalPatchRealtimeSession: (input) => door.answerPatchRealtimeSession(input),
      answerInternalReportRealtimeUsage: (input) => door.answerReportRealtimeUsage(input),
    },
    "GatewayInternalDoorApi",
  );
  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: GatewayInternalIdentityService.create({ secret }),
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
  const url = new URL(`http://api.test${input.path}`);
  // The signature covers the PATH only: the query string is not signed, as the data plane does.
  const signature = gatewayInternalSignatureHeaders({
    secret,
    method: input.method,
    path: url.pathname,
    body,
    nowMs: Date.now(),
  });

  return new Request(url, {
    method: input.method,
    ...(input.body === undefined ? {} : { body }),
    headers: {
      "Content-Type": "application/json",
      ...signature,
      ...input.headers,
    },
  });
}
