/**
 * The one HTTP client every request to the LangWatch API goes through.
 *
 * A LangWatch endpoint configured as `http://app.langwatch.ai` answers with a
 * redirect to https. The global `fetch` follows it on its own and, for a 301
 * or 302, turns the POST into a GET and drops the body, so the event is lost
 * without an error. This client sends with `redirect: "manual"` and applies a
 * rule per method to the 3xx it gets back.
 *
 * GET and HEAD follow a 301, 302, 303, 307 or 308 with the same method, up to
 * five hops. A hop that keeps the origin, or only upgrades http to https on
 * the same host and port, keeps every header; any other hop drops the
 * credential headers first. A hop from https to http and a hop without a
 * Location are refused.
 *
 * Every other method follows exactly one redirect, and only when the target is
 * the same URL with the scheme changed from http to https (same host, port,
 * path and query). The replay uses the same method, headers and body bytes.
 *
 * Every refused redirect throws `LangWatchRedirectError`.
 *
 * This module depends on the SDK logger only, so the CLI boot graph and the
 * `agent` entry can import it without pulling anything else in.
 */
import { ConsoleLogger, type Logger } from "../../logger";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Methods that follow a redirect to any http or https URL. */
const FOLLOWING_METHODS = new Set(["GET", "HEAD"]);

/** The most redirects a GET or HEAD follows before the next one is refused. */
export const MAX_FOLLOW_HOPS = 5;

/**
 * Headers dropped when a GET or HEAD hop leaves the origin: the three the Fetch
 * standard strips on a cross-origin redirect, plus the names LangWatch keys on.
 */
const CREDENTIAL_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-project-id",
];

export class LangWatchRedirectError extends Error {
  readonly url: string;
  readonly location: string | null;
  readonly status: number;

  constructor({
    url,
    location,
    status,
  }: {
    url: string;
    location: string | null;
    status: number;
  }) {
    super(
      `LangWatch refused to follow a redirect from ${url} to ${location ?? "an unknown location"} (HTTP ${status}). Set the endpoint to the final URL.`,
    );
    this.name = "LangWatchRedirectError";
    this.url = url;
    this.location = location;
    this.status = status;
  }
}

export type LangWatchFetch = typeof globalThis.fetch;

export interface CreateLangWatchFetchOptions {
  /** The transport to send with. Defaults to the global `fetch` at call time. */
  fetch?: LangWatchFetch;
  /** Receives the one warning per process about an http endpoint. */
  logger?: Logger;
}

/** Origins that already produced the http-to-https warning in this process. */
const warnedOrigins = new Set<string>();

/** Forgets which origins were warned about. For tests only. */
export const resetSchemeUpgradeWarnings = (): void => {
  warnedOrigins.clear();
};

const isRedirect = (response: Response): boolean =>
  response.type === "opaqueredirect" || REDIRECT_STATUSES.has(response.status);

const isStream = (body: unknown): boolean =>
  typeof ReadableStream !== "undefined" && body instanceof ReadableStream;

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ??
  (typeof DOMException !== "undefined"
    ? new DOMException("This operation was aborted", "AbortError")
    : Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));

/**
 * The body bytes to replay, read under the caller's signal.
 *
 * A `Request` built from a stream hands its copy over as a stream too, and
 * reading one that never ends would leave the call pending for good, past an
 * abort the caller already made. The read races the signal and cancels the
 * copy it loses to, so an aborted call settles.
 */
const replayBody = async ({
  spare,
  signal,
}: {
  spare: Request;
  signal: AbortSignal | null | undefined;
}): Promise<ArrayBuffer> => {
  if (!signal) return spare.arrayBuffer();
  if (signal.aborted) throw abortError(signal);

  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
  });
  // An abort that arrives after the read already won still rejects this one,
  // and nothing would be waiting on it by then.
  void aborted.catch(() => undefined);
  try {
    return await Promise.race([spare.arrayBuffer(), aborted]);
  } catch (error) {
    await spare.body?.cancel().catch(() => undefined);
    throw error;
  }
};

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const parseHop = ({
  url,
  location,
}: {
  url: string;
  location: string;
}): { from: URL; to: URL } | null => {
  try {
    const from = new URL(url);
    return { from, to: new URL(location, from) };
  } catch {
    return null;
  }
};

/** Same host and port, with the scheme changed from http to https. */
const isSchemeUpgrade = ({ from, to }: { from: URL; to: URL }): boolean =>
  from.protocol === "http:" &&
  to.protocol === "https:" &&
  from.hostname === to.hostname &&
  from.port === to.port;

/**
 * The https URL to replay against when `location` only upgrades the scheme of
 * `url`, and null for any other target. The URL parser drops a default port,
 * so `http://host:80` and `https://host:443` both read as no port.
 */
export const schemeUpgradeTarget = ({
  url,
  location,
}: {
  url: string;
  location: string;
}): string | null => {
  const hop = parseHop({ url, location });
  if (hop === null || !isSchemeUpgrade(hop)) return null;
  const { from, to } = hop;
  if (from.pathname !== to.pathname) return null;
  if (from.search !== to.search) return null;
  to.hash = "";
  return to.href;
};

/**
 * The URL a GET or HEAD follows to, and null when the hop is refused: a
 * target that is not http or https, or a downgrade from https to http.
 */
export const followTarget = ({
  url,
  location,
}: {
  url: string;
  location: string;
}): string | null => {
  const hop = parseHop({ url, location });
  if (hop === null) return null;
  const { from, to } = hop;
  if (to.protocol !== "http:" && to.protocol !== "https:") return null;
  if (from.protocol === "https:" && to.protocol === "http:") return null;
  to.hash = "";
  return to.href;
};

/** A hop keeps its credential headers on the same origin and on an https upgrade of the same host. */
const keepsCredentials = ({ from, to }: { from: URL; to: URL }): boolean =>
  from.origin === to.origin || isSchemeUpgrade({ from, to });

const withoutCredentials = (headers: Headers): Headers => {
  const stripped = new Headers(headers);
  for (const name of CREDENTIAL_HEADERS) stripped.delete(name);
  return stripped;
};

const warnOnce = ({ url, logger }: { url: string; logger: Logger }): void => {
  const { origin, host } = new URL(url);
  if (warnedOrigins.has(origin)) return;
  warnedOrigins.add(origin);
  logger.warn(
    `LangWatch endpoint ${origin} redirected to https. Set the endpoint to https://${host} to skip the extra round trip.`,
  );
};

const refusalOf = ({
  url,
  response,
}: {
  url: string;
  response: Response;
}): LangWatchRedirectError =>
  new LangWatchRedirectError({
    url,
    location: response.headers.get("location"),
    status: response.status,
  });

/**
 * What `fetch(input, init)` would send, as one request both sends read from.
 * `init` wins over a `Request` input field by field, so reading the raw input
 * for the replay would resend a method, headers or body the caller overrode.
 * A plain URL input stays null: the non-Request path keeps `init` as it is, so
 * a stream body reaches the transport untouched.
 */
const effectiveRequest = ({
  input,
  init,
}: {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}): Request | null =>
  typeof Request !== "undefined" && input instanceof Request
    ? new Request(input, { ...init, redirect: "manual" })
    : null;

interface Hop {
  send: LangWatchFetch;
  log: Logger;
  effective: Request | null;
  init: RequestInit | undefined;
  url: string;
  first: Response;
}

/** The GET and HEAD rule: follow with the same method, up to MAX_FOLLOW_HOPS. */
const follow = async ({
  send,
  log,
  effective,
  init,
  url,
  method,
  first,
}: Hop & { method: string }): Promise<Response> => {
  let headers = new Headers(effective?.headers ?? init?.headers);
  const signal = effective?.signal ?? init?.signal;
  let current = url;
  let response = first;

  for (let hop = 0; hop < MAX_FOLLOW_HOPS; hop++) {
    const location = response.headers.get("location");
    const target = location === null ? null : followTarget({ url: current, location });
    if (target === null) throw refusalOf({ url: current, response });

    const from = new URL(current);
    const to = new URL(target);
    if (!keepsCredentials({ from, to })) headers = withoutCredentials(headers);
    if (isSchemeUpgrade({ from, to })) warnOnce({ url: current, logger: log });

    current = target;
    response = effective
      ? await send(new Request(target, { method, headers, signal, redirect: "manual" }))
      : await send(target, { ...init, method, headers, body: undefined, redirect: "manual" });
    if (!isRedirect(response)) return response;
  }

  throw refusalOf({ url: current, response });
};

/** The rule for every other method: one hop, and only an https upgrade of the same URL. */
const upgrade = async ({
  send,
  log,
  effective,
  init,
  url,
  first,
  spare,
}: Hop & { spare: Request | null }): Promise<Response> => {
  const location = first.headers.get("location");
  const refused = refusalOf({ url, response: first });
  if (location === null || first.status === 303) throw refused;
  const target = schemeUpgradeTarget({ url, location });
  if (target === null || isStream(init?.body)) throw refused;

  warnOnce({ url, logger: log });

  const second = effective
    ? await send(
        new Request(target, {
          method: effective.method,
          headers: effective.headers,
          body: spare ? await replayBody({ spare, signal: effective.signal }) : null,
          signal: effective.signal,
          redirect: "manual",
        }),
      )
    : await send(target, { ...init, redirect: "manual" });
  if (!isRedirect(second)) return second;

  throw refusalOf({ url: target, response: second });
};

/**
 * Builds a `fetch` that applies the redirect rule. Pass `fetch` to send through
 * another transport (a test double, a proxying client) and `logger` to route
 * the http endpoint warning.
 */
export const createLangWatchFetch = ({
  fetch: fetchImpl,
  logger,
}: CreateLangWatchFetchOptions = {}): LangWatchFetch => {
  const send: LangWatchFetch =
    fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const log = logger ?? new ConsoleLogger({ level: "warn", prefix: "LangWatch" });

  return async (input, init) => {
    const url = requestUrl(input);
    const effective = effectiveRequest({ input, init });
    const method = (effective?.method ?? init?.method ?? "GET").toUpperCase();
    // A Request carries its body as a stream that one send consumes, so a copy
    // is taken before the first send and read only if the replay happens.
    const spare = effective !== null && effective.body !== null ? effective.clone() : null;

    const first = effective
      ? await send(effective)
      : await send(input, { ...init, redirect: "manual" });
    if (!isRedirect(first)) return first;

    const hop = { send, log, effective, init, url, first };
    return FOLLOWING_METHODS.has(method)
      ? follow({ ...hop, method })
      : upgrade({ ...hop, spare });
  };
};

/** The shared client, bound to the global `fetch` and the SDK console logger. */
export const langwatchFetch: LangWatchFetch = createLangWatchFetch();
