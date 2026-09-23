import { isIP } from "node:net";

import { createLogger } from "@langwatch/observability";
import { Agent, type Response as FetchResponse, fetch as undiciFetch } from "undici";

import type { SsrfUrlValidator, SsrfValidationResult } from "./url-validator.ts";

/**
 * FROZEN TWIN of the fetch half of `platform/app/src/utils/ssrfProtection.ts`.
 * Pins the connection to the policy-judged IP so the hostname cannot be
 * re-resolved after the decision, while `Host`/TLS servername keep the original.
 */

/**
 * Redirects are `manual`, always: `followRedirects: false` refuses every
 * hop; each hop is otherwise re-validated through `revalidate` (a caller
 * parameter, since this module has no environment) up to `MAX_REDIRECTS`.
 */

/**
 * Two independent timeout bounds, both opt-in: `init.signal` carries across
 * every hop; `headersTimeoutMs` / `bodyTimeoutMs` back it as a socket-level
 * backstop if the signal drops. Omitted, undici's 300s defaults apply.
 */

const logger = createLogger("langwatch:ssrfProtection");

/** How many hops a followed redirect chain may take before it is abandoned. */
const MAX_REDIRECTS = 10;

/**
 * Whether TLS certificates are verified on this deployment. Tied to
 * `IS_SAAS`, separately from the address policy, because on-prem operators
 * often use self-signed certificates — unrelated to private-address reachability.
 */
export interface EgressTlsPolicy {
  rejectUnauthorized: boolean;
}

type ErrorFormatter = (hostname: string, port: number, message: string) => string;

const CONNECTION_ERROR_FORMATTERS: Record<string, ErrorFormatter> = {
  ECONNREFUSED: (h, p) => `Connection refused - is the server running at ${h}:${p}?`,
  ENOTFOUND: (h) => `Could not resolve hostname: ${h}`,
  ETIMEDOUT: (h, p) => `Connection timed out while connecting to ${h}:${p}`,
  ECONNRESET: (h, p) => `Connection was reset by ${h}:${p}`,
  CERT_HAS_EXPIRED: (h, _p, m) => `TLS certificate error for ${h}: ${m}`,
  DEPTH_ZERO_SELF_SIGNED_CERT: (h, _p, m) => `TLS certificate error for ${h}: ${m}`,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: (h, _p, m) => `TLS certificate error for ${h}: ${m}`,
};

function formatConnectionError(err: Error, hostname: string, port: number): Error {
  const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
  const formatter = CONNECTION_ERROR_FORMATTERS[code];
  const message = formatter
    ? formatter(hostname, port, err.message)
    : `Connection failed to ${hostname}:${port}: ${err.message}`;
  return new Error(message);
}

/**
 * The receiver redirected and this caller declined the hop. A class, not a
 * message, so it passes untouched through the catch below that rewrites
 * every plain `Error` as "Connection failed" via `formatConnectionError`.
 */
export class RedirectRefusedError extends Error {
  constructor(
    message = "Redirects are not followed for this destination — the endpoint must answer directly.",
  ) {
    super(message);
    this.name = "RedirectRefusedError";
  }
}

export interface FencedFetchOptions extends RequestInit {
  _redirectCount?: number;
  /**
   * Set false to refuse redirects outright: a 3xx carrying a Location throws
   * instead of hopping. What every customer-supplied destination passes.
   */
  followRedirects?: boolean;
  /**
   * The policy the NEXT hop is judged by, when redirects are followed at all.
   * Absent while `followRedirects` is not false means a redirect cannot be
   * evaluated, and an unevaluable hop is refused.
   */
  revalidate?: SsrfUrlValidator;
  /** Socket-level bound on how long the receiver may take to send headers. */
  headersTimeoutMs?: number;
  /** Socket-level bound on inactivity while streaming the response body. */
  bodyTimeoutMs?: number;
}

interface AgentTimeoutOptions {
  headersTimeout?: number;
  bodyTimeout?: number;
}

function resolveAgentTimeouts(init: FencedFetchOptions | undefined): AgentTimeoutOptions {
  const timeouts: AgentTimeoutOptions = {};
  if (init?.headersTimeoutMs !== undefined) {
    timeouts.headersTimeout = init.headersTimeoutMs;
  }
  if (init?.bodyTimeoutMs !== undefined) {
    timeouts.bodyTimeout = init.bodyTimeoutMs;
  }
  return timeouts;
}

function createIpPinningAgent(
  resolvedIp: string,
  tls: EgressTlsPolicy,
  timeouts: AgentTimeoutOptions,
): Agent {
  return new Agent({
    ...timeouts,
    connect: {
      rejectUnauthorized: tls.rejectUnauthorized,
      lookup: (_hostname, _options, callback) => {
        callback(null, [{ address: resolvedIp, family: isIP(resolvedIp) === 6 ? 6 : 4 }]);
      },
    },
  });
}

function getResolvedIpForPinning(result: SsrfValidationResult): string | null {
  switch (result.type) {
    case "resolved":
      return result.resolvedIp;
    case "allowlisted":
      return result.resolvedIp ?? null;
    case "unresolved":
      return null;
  }
}

/**
 * Fetches an already-validated destination at its validated address. TLS
 * policy is a required argument, not a default: a package has no deployment
 * to read one from, and a wrong default breaks receivers or stops verifying.
 */
export async function fetchValidatedDestination(
  validated: SsrfValidationResult,
  init: FencedFetchOptions | undefined,
  tls: EgressTlsPolicy,
): Promise<FetchResponse> {
  const headers = new Headers(init?.headers);
  const redirectCount = init?._redirectCount ?? 0;

  if (!headers.has("Host")) {
    headers.set("Host", validated.hostname);
  }

  const requestUrl = `${validated.protocol}//${validated.hostname}:${validated.port}${validated.path}`;
  const resolvedIp = getResolvedIpForPinning(validated);
  const agentTimeouts = resolveAgentTimeouts(init);

  const dispatcher =
    resolvedIp && isIP(resolvedIp) !== 0
      ? createIpPinningAgent(resolvedIp, tls, agentTimeouts)
      : new Agent({
          ...agentTimeouts,
          connect: { rejectUnauthorized: tls.rejectUnauthorized },
        });

  try {
    const response = await undiciFetch(requestUrl, {
      method: init?.method,
      // Entries, not the `Headers` instance: two copies of the undici types
      // are reachable here (this package's, and `@types/node`'s), and a
      // consumer with both in scope cannot assign one's `Headers` to the
      // other's parameter even though they're the same object at runtime.
      headers: [...headers],
      body: init?.body as string | undefined,
      // Without this the caller's AbortSignal.timeout(...) is silently dropped
      // and undici's 300s default is the only bound — across every hop.
      signal: init?.signal,
      redirect: "manual",
      dispatcher,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        return await followRedirect({
          status: response.status,
          location,
          validated,
          init,
          tls,
          redirectCount,
        });
      }
    }

    return response;
  } catch (err) {
    // Our own refusal, not the network's. Everything below rewrites an error
    // into "Connection failed to host:port: …", the right shape for a socket
    // problem and the wrong one for a decision this module made.
    if (err instanceof RedirectRefusedError) {
      throw err;
    }
    if (err instanceof Error) {
      const cause = (err as Error & { cause?: Error }).cause;
      if (cause) {
        throw formatConnectionError(cause, validated.hostname, validated.port);
      }
      throw formatConnectionError(err, validated.hostname, validated.port);
    }
    throw err;
  }
}

async function followRedirect({
  status,
  location,
  validated,
  init,
  tls,
  redirectCount,
}: {
  status: number;
  location: string;
  validated: SsrfValidationResult;
  init: FencedFetchOptions | undefined;
  tls: EgressTlsPolicy;
  redirectCount: number;
}): Promise<FetchResponse> {
  if (init?.followRedirects === false) {
    throw new RedirectRefusedError();
  }
  if (redirectCount >= MAX_REDIRECTS) {
    throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
  }
  if (!init?.revalidate) {
    // Fail closed. The hop is a destination nothing has judged, and a package
    // that guessed here would be admitting an address on the receiver's say-so.
    throw new RedirectRefusedError(
      "Redirects are not followed without an address policy to judge the next hop.",
    );
  }

  const redirectUrl = new URL(location, validated.originalUrl).toString();

  logger.debug(
    { originalUrl: validated.originalUrl, redirectUrl, redirectCount: redirectCount + 1 },
    "Following redirect with SSRF validation",
  );

  const redirectValidated = await init.revalidate(redirectUrl);

  // `signal` and the socket-level bounds are carried into every hop, so one
  // caller deadline bounds the WHOLE chain rather than each hop independently.
  const redirectInit: FencedFetchOptions = {
    ...init,
    signal: init.signal,
    headersTimeoutMs: init.headersTimeoutMs,
    bodyTimeoutMs: init.bodyTimeoutMs,
    _redirectCount: redirectCount + 1,
  };

  // The method downgrade every HTTP client makes: 303 always becomes a GET, and
  // so does a POST through a redirect that is not 307 or 308. Carrying the body
  // through would re-send it to an address the original request never named.
  if (status === 303) {
    redirectInit.method = "GET";
    redirectInit.body = undefined;
  } else if (status !== 307 && status !== 308 && init.method === "POST") {
    redirectInit.method = "GET";
    redirectInit.body = undefined;
  }

  return fetchValidatedDestination(redirectValidated, redirectInit, tls);
}
