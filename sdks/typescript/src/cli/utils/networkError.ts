/**
 * Turning `fetch failed` into something a person can act on.
 *
 * `fetch` collapses every transport failure into one `TypeError: fetch failed`
 * and hides the real reason on `.cause`. Printed raw it is the least useful
 * error the CLI can emit: it does not say whether LangWatch is down, the
 * laptop is offline, the URL is malformed, or a corporate proxy ate the
 * handshake — and those have four different fixes.
 *
 * Every failure named here happened on THIS machine, before any request
 * reached LangWatch. That is the single most useful fact to lead with, because
 * it tells the reader to stop checking the status page.
 */

/** A transport failure, named and blamed correctly. */
export class ClientSideNetworkError extends Error {
  /** Serialisable discriminant, in the platform's `snake_case` style. */
  readonly code: string;
  /**
   * `client` — not `customer`, `platform` or `provider`. The request never
   * landed, so no server has an opinion about it.
   */
  readonly fault = "client" as const;
  /** The status the platform answered with; 0 because it never answered. */
  readonly httpStatus = 0;
  readonly tips: readonly string[];
  readonly url: string;
  readonly cause: unknown;
  /** The one-line summary, without the tips appended to `message`. */
  readonly headline: string;

  constructor(params: {
    code: string;
    message: string;
    tips?: readonly string[];
    url: string;
    cause?: unknown;
  }) {
    // `message` carries the tips because the CLI's generic error reporter
    // prints only `error.message` — guidance kept elsewhere would never be
    // seen, which is the whole failure this class exists to fix.
    super(
      [params.message, ...(params.tips ?? []).map((t) => `  ${t}`)].join("\n"),
    );
    this.name = "ClientSideNetworkError";
    this.headline = params.message;
    // Assigned rather than passed to `super`: the error-cause constructor
    // option needs a newer lib target than this package compiles against.
    this.cause = params.cause;
    this.code = params.code;
    this.tips = params.tips ?? [];
    this.url = params.url;
  }

  /** Message plus tips, ready for stderr. Same as `message`, named for intent. */
  toDisplayString(): string {
    return this.message;
  }
}

/** Walk the `cause` chain for the libuv / OpenSSL code fetch buried. */
function underlyingCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Reject an endpoint that cannot be fetched, before it becomes a confusing
 * transport error.
 *
 * Note what this deliberately does NOT reject: `https:\host`. The WHATWG
 * parser treats backslashes as slashes for special schemes, so that
 * normalises to `https://host/` and works fine — it merely *looks* broken
 * when a config value is printed verbatim. Rejecting it would break working
 * setups over a cosmetic complaint.
 */
export function assertUsableEndpoint(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ClientSideNetworkError({
      code: "endpoint_malformed",
      message: `The LangWatch endpoint is not a valid URL: ${url}`,
      tips: [
        "Expected something like https://app.langwatch.ai",
        "Check LANGWATCH_ENDPOINT, or run `langwatch config set endpoint <url>`.",
      ],
      url,
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ClientSideNetworkError({
      code: "endpoint_malformed",
      message: `The LangWatch endpoint must be http or https, got "${parsed.protocol}" in ${url}`,
      tips: [
        "Expected something like https://app.langwatch.ai",
        "Check LANGWATCH_ENDPOINT, or run `langwatch config set endpoint <url>`.",
      ],
      url,
    });
  }

  if (!parsed.host) {
    throw new ClientSideNetworkError({
      code: "endpoint_malformed",
      message: `The LangWatch endpoint has no host: ${url}`,
      tips: ["Expected something like https://app.langwatch.ai"],
      url,
    });
  }
}

/**
 * Name a failed `fetch`.
 *
 * Always returns a `ClientSideNetworkError` — this is only ever called when
 * the request threw rather than answering, and a request that never landed is
 * definitionally a local failure.
 */
export function diagnoseFetchFailure(
  error: unknown,
  url: string,
): ClientSideNetworkError {
  const host = hostOf(url);
  const code = underlyingCode(error);
  const base = { url, cause: error } as const;

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return new ClientSideNetworkError({
        ...base,
        code: "network_dns_failure",
        message: `Could not resolve ${host} — this failed on your machine, before reaching LangWatch.`,
        tips: [
          "Check the hostname for typos, and that you are online.",
          "On a `.localhost` endpoint, the local stack may not be running.",
        ],
      });

    case "ECONNREFUSED":
      return new ClientSideNetworkError({
        ...base,
        code: "network_connection_refused",
        message: `Nothing is listening at ${host} — this failed on your machine, before reaching LangWatch.`,
        tips: [
          "If this is a local endpoint, start the stack first.",
          "Otherwise check the port, or whether you meant a different endpoint.",
        ],
      });

    case "ECONNRESET":
    case "EPIPE":
      return new ClientSideNetworkError({
        ...base,
        code: "network_connection_reset",
        message: `The connection to ${host} was dropped before a reply arrived.`,
        tips: ["A proxy or VPN in the middle is the usual cause. Retry once."],
      });

    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
      return new ClientSideNetworkError({
        ...base,
        code: "network_timeout",
        message: `Timed out connecting to ${host} — no reply from your machine's side of the connection.`,
        tips: ["Check connectivity, a VPN, or a proxy that is silently dropping traffic."],
      });

    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return new ClientSideNetworkError({
        ...base,
        code: "network_tls_untrusted",
        message: `Your machine does not trust the TLS certificate for ${host} (${code}).`,
        tips: [
          "A local stack usually needs its development CA trusted first.",
          "A corporate proxy re-signing traffic needs its root installed.",
        ],
      });

    case "ERR_INVALID_URL":
      return new ClientSideNetworkError({
        ...base,
        code: "endpoint_malformed",
        message: `The LangWatch endpoint is not a valid URL: ${url}`,
        tips: ["Expected something like https://app.langwatch.ai"],
      });

    default:
      return new ClientSideNetworkError({
        ...base,
        code: "network_unreachable",
        message:
          `Could not reach ${host} — this failed on your machine, before reaching LangWatch` +
          (code ? ` (${code}).` : "."),
        tips: [
          "Check that you are online and that the endpoint is correct.",
          `Underlying error: ${(error as Error)?.message ?? String(error)}`,
        ],
      });
  }
}
