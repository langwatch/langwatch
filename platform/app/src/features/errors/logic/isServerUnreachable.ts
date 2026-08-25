/**
 * A failure that never reached the server at all.
 *
 * These are not refusals and they are not bugs, and the difference matters
 * because of what we say about them. Our generic copy for an unrecognised
 * failure is "We've been notified. Try again in a moment." — which is a
 * promise, and when the request never left the browser it is a promise
 * nobody can keep: there is no trace, no report, nothing was notified. A
 * deploy rolling, a laptop waking up, a server still coming up all land here,
 * and all three read as "LangWatch is broken and knows it".
 *
 * So this is the one distinction the error surface has to make before it
 * reaches for the registry: did we get an ANSWER, or did we get nothing?
 *
 * ── Deliberately conservative ────────────────────────────────────────────
 *
 * A false positive is worse than a false negative. Calling a real server
 * refusal "we can't reach the server" hides a fault we could have named and
 * tells the reader to wait for something that is never going to change on its
 * own. So a failure only counts as unreachable when it has BOTH marks: a
 * message that is one of the handful of things browsers say when a fetch
 * never completed, AND no sign of a response — no status, no error code,
 * nothing a server could have put there.
 *
 * The messages differ per engine and none of them are ours to control, which
 * is why the list is matched loosely and the second condition carries the
 * real weight.
 */

/** What each engine says when a fetch never completed. */
const TRANSPORT_FAILURES = [
  "failed to fetch", // Chromium
  "networkerror when attempting to fetch resource", // Firefox
  "load failed", // Safari
  "network request failed",
  "fetch failed", // undici, on the server side of a proxy hop
  "the network connection was lost",
  "err_connection_refused",
  "err_network_changed",
];

/**
 * Whether this failure never got an answer.
 *
 * Also true when the browser itself says it is offline, which is the one case
 * we can be certain about without inspecting anything.
 */
export function isServerUnreachable(error: unknown): boolean {
  if (!error) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

  const message = messageOf(error);
  if (!message) return false;
  if (!TRANSPORT_FAILURES.some((phrase) => message.includes(phrase))) {
    return false;
  }

  // A server that ANSWERED — even to refuse — is reachable, whatever the
  // message happens to say. This is the half that keeps a named refusal from
  // being mistaken for a network blip.
  return !carriesAResponse(error);
}

function messageOf(error: unknown): string | null {
  if (typeof error === "string") return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message?: unknown };
    return typeof message === "string" ? message.toLowerCase() : null;
  }
  return null;
}

/**
 * Any trace of a reply. tRPC hangs the server's answer off `data`, and a
 * transport failure has none of it — no HTTP status, no code, no shape.
 */
function carriesAResponse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { data } = error as { data?: unknown };
  if (typeof data !== "object" || data === null) return false;
  const { httpStatus, code } = data as {
    httpStatus?: unknown;
    code?: unknown;
  };
  return typeof httpStatus === "number" || typeof code === "string";
}
