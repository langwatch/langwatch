/**
 * The `/api/internal/gateway` family on a runtime that stands in for the
 * process: no framework credential at all, the family's own HMAC gate under its
 * paths, and the error envelope the Go data plane parses.
 *
 * A test supplies only the members its routes reach. Anything else is a throw
 * naming what was asked for, so a route that quietly grew a second dependency
 * fails here instead of passing on an undefined.
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type { ErrorHandler } from "hono";

import {
  buildGatewayCanonicalString,
  computeGatewaySignature,
  gatewayInternalRest,
  gatewayInternalSignature,
  type GatewayInternalApp,
} from "../../gateway-internal.rest.ts";

/**
 * Sequential-hex HMAC fixture, not a credential; allowlisted by path in
 * .gitleaks.toml.
 */
export const GATEWAY_INTERNAL_TEST_SECRET = "0123456789abcdef0123456789abcdef";

/** Nothing here is expected to throw, so a failure must be legible. */
const renderUnexpected: ErrorHandler = (error, c) =>
  c.json(
    { error: { type: "internal_error", code: "internal_error", message: String(error) } },
    500,
  );

/** Only what the test named; everything else says so by name. */
function suppliedMembers(members: Partial<GatewayInternalApp>): GatewayInternalApp {
  return new Proxy(members as GatewayInternalApp, {
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
  members: Partial<GatewayInternalApp>,
  options: { secret?: string | undefined } = {},
) {
  const secret = options.secret ?? GATEWAY_INTERNAL_TEST_SECRET;
  const app = suppliedMembers(members);
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("this family resolves no framework credential");
      },
    },
  });

  return runtime.mount(gatewayInternalRest.router(), {
    app: () => app,
    onError: renderUnexpected,
    middleware: [gatewayInternalSignature(() => secret)],
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
