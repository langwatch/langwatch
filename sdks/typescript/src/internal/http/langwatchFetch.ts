/**
 * The one HTTP client every request to the LangWatch API goes through.
 *
 * A LangWatch endpoint configured as `http://app.langwatch.ai` answers with a
 * redirect to https. The global `fetch` follows it on its own and, for a 301
 * or 302, turns the POST into a GET and drops the body, so the event is lost
 * without an error. This client sends with `redirect: "manual"` and applies a
 * single rule to the 3xx it gets back: a redirect is followed once, and only
 * when the target is the same URL with the scheme changed from http to https
 * (same host, port, path and query). The replay uses the same method, headers
 * and body bytes. Every other redirect is refused with `LangWatchRedirectError`.
 *
 * This module depends on the SDK logger only, so the CLI boot graph and the
 * `agent` entry can import it without pulling anything else in.
 */
import { ConsoleLogger, type Logger } from "../../logger";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

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
  let from: URL;
  let to: URL;
  try {
    from = new URL(url);
    to = new URL(location, from);
  } catch {
    return null;
  }
  if (from.protocol !== "http:" || to.protocol !== "https:") return null;
  if (from.hostname !== to.hostname) return null;
  if (from.port !== to.port) return null;
  if (from.pathname !== to.pathname) return null;
  if (from.search !== to.search) return null;
  to.hash = "";
  return to.href;
};

const warnOnce = ({ url, logger }: { url: string; logger: Logger }): void => {
  const { origin, host } = new URL(url);
  if (warnedOrigins.has(origin)) return;
  warnedOrigins.add(origin);
  logger.warn(
    `LangWatch endpoint ${origin} redirected to https. Set the endpoint to https://${host} to skip the extra round trip.`,
  );
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
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = requestUrl(input);
    const streamed = isStream(init?.body);
    // A Request carries its body as a stream that one send consumes, so a copy
    // is taken before the first send and read only if the replay happens.
    const spare =
      isRequest && init?.body === undefined && input.body !== null
        ? input.clone()
        : null;

    const first = isRequest
      ? await send(new Request(input, { ...init, redirect: "manual" }))
      : await send(input, { ...init, redirect: "manual" });
    if (!isRedirect(first)) return first;

    const location = first.headers.get("location");
    const refused = new LangWatchRedirectError({
      url,
      location,
      status: first.status,
    });
    if (location === null || first.status === 303) throw refused;
    const target = schemeUpgradeTarget({ url, location });
    if (target === null || streamed) throw refused;

    warnOnce({ url, logger: log });

    const second = isRequest
      ? await send(
          new Request(target, {
            method: input.method,
            headers: input.headers,
            body: spare ? await spare.arrayBuffer() : null,
            signal: input.signal,
            redirect: "manual",
          }),
        )
      : await send(target, { ...init, redirect: "manual" });
    if (!isRedirect(second)) return second;

    throw new LangWatchRedirectError({
      url: target,
      location: second.headers.get("location"),
      status: second.status,
    });
  };
};

/** The shared client, bound to the global `fetch` and the SDK console logger. */
export const langwatchFetch: LangWatchFetch = createLangWatchFetch();
