import { isIP } from "node:net";
import { createLogger } from "@langwatch/observability";
import { Agent, type Response as FetchResponse, fetch as undiciFetch } from "undici";
import type { SsrfUrlValidator, SsrfValidationResult } from "./url-validator";

/**
 * The fetch a validated destination is actually reached through.
 *
 * FROZEN TWIN of the fetch half of `platform/app/src/utils/ssrfProtection.ts`
 * (`fetchWithResolvedIp`, `RedirectRefusedError`, the connection-error
 * formatters and the redirect ladder). The application keeps its copy while
 * both graphs send.
 *
 * ## Why it is not a plain fetch
 * The connection is pinned to the IP the policy judged, via an undici Agent
 * whose `lookup` answers that address and nothing else, so the name cannot be
 * re-resolved to somewhere else between the decision and the socket. The `Host`
 * header and TLS servername still carry the original hostname, so the receiver
 * routes correctly.
 *
 * ## Redirects
 * `redirect: "manual"`, always. What happens next is the caller's policy:
 * - `followRedirects: false` refuses the hop outright. This is what a
 *   customer-supplied destination uses: a hop is a new address that the
 *   original admission never judged.
 * - Otherwise the hop is re-validated through `revalidate` before it is taken,
 *   at most `MAX_REDIRECTS` times, carrying the caller's deadline across every
 *   hop so one signal bounds the whole chain.
 *
 * THE ONE DELIBERATE DIFFERENCE FROM THE APPLICATION'S COPY: there, the hop is
 * re-validated by a module-level validator built from the environment, and the
 * webhook channel refuses redirects precisely BECAUSE that validator is weaker
 * than the one the send was admitted under. A package has no environment to
 * build such a validator from, so `revalidate` is a parameter — and a caller
 * that asked to follow redirects without supplying one is refused rather than
 * allowed through unjudged. An admission this module cannot evaluate refuses.
 *
 * ## Timeouts
 * Two independent bounds, both opt-in: `init.signal` is forwarded to undici and
 * carried across every hop, and `headersTimeoutMs` / `bodyTimeoutMs` ride on the
 * Agent as a socket-level backstop, so a slowloris receiver is still bounded if
 * the signal is ever dropped. Omitted leaves undici's 300s defaults.
 */

const logger = createLogger("langwatch:ssrfProtection");

/** How many hops a followed redirect chain may take before it is abandoned. */
const MAX_REDIRECTS = 10;

/**
 * Whether TLS certificates are verified on this deployment.
 *
 * Separate from the address policy on purpose, and injected for the same reason
 * the address policy is: the application ties it to `IS_SAAS` because an on-prem
 * operator frequently calls services with self-signed certificates, which has
 * nothing to do with whether private addresses are reachable.
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
 * The receiver redirected and this caller declined the hop.
 *
 * A class rather than a message, because the catch below funnels every plain
 * `Error` through `formatConnectionError`, which rewrites it as "Connection
 * failed to host:port: …". A caller told the endpoint was unreachable goes and
 * checks their network, when the endpoint answered perfectly well and simply
 * redirected. This type passes through that catch untouched.
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
 * Fetches an already-validated destination at the address it was validated at.
 *
 * The TLS policy is a required argument rather than a module default: a package
 * has no deployment to read it from, and a wrong default either breaks every
 * on-prem receiver with a self-signed certificate or silently stops verifying
 * certificates in production.
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
      headers,
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
  if (status === 303 || (status !== 307 && status !== 308 && init.method === "POST")) {
    redirectInit.method = "GET";
    redirectInit.body = undefined;
  }

  return await fetchValidatedDestination(redirectValidated, redirectInit, tls);
}
