/**
 * Fixed, customer-safe copy naming why a request never got an answer. The raw
 * error carries hosts, resolved addresses and undici internals, so only the
 * kind of failure is read from it; none of its text is repeated.
 */
const TRANSPORT_FAILURES: ReadonlyArray<{ pattern: RegExp; copy: string }> = [
  {
    pattern:
      /ssrf|not allowed for security|private or localhost|metadata endpoint|internal domain/i,
    copy: "That address is not allowed: webhooks cannot reach private, local or cloud metadata addresses.",
  },
  {
    pattern: /redirects are not followed|too many redirects/i,
    copy: "The endpoint answered with a redirect, which is not followed. Use the final URL.",
  },
  {
    pattern: /ENOTFOUND|EAI_AGAIN|resolve hostname/i,
    copy: "The endpoint's hostname could not be resolved. Check the URL.",
  },
  {
    pattern: /ECONNREFUSED|connection refused/i,
    copy: "The endpoint refused the connection. Check the URL and that the server is running.",
  },
  {
    pattern: /ETIMEDOUT|timed out|timeout/i,
    copy: "The endpoint did not answer in time.",
  },
  {
    pattern: /TLS|SSL|certificate|CERT_/i,
    copy: "The endpoint's TLS certificate could not be verified.",
  },
  {
    pattern: /ECONNRESET|reset by|socket hang up|other side closed/i,
    copy: "The endpoint closed the connection before answering.",
  },
];

const UNREACHABLE = "The endpoint could not be reached.";

function describeChain(error: unknown, depth = 0): string {
  if (depth > 3 || typeof error !== "object" || error === null) {
    return typeof error === "string" ? error : "";
  }
  const parts = [
    "name" in error ? String(error.name) : "",
    "code" in error ? String(error.code) : "",
    "message" in error ? String(error.message) : "",
    "cause" in error ? describeChain(error.cause, depth + 1) : "",
  ];
  return parts.join(" ");
}

/** Names the kind of transport failure, never its detail. */
export function describeTransportFailure(error: unknown): string {
  const text = describeChain(error);
  return (
    TRANSPORT_FAILURES.find(({ pattern }) => pattern.test(text))?.copy ??
    UNREACHABLE
  );
}
