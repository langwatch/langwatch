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
 * What an intermediary returns when it could not get an answer out of us.
 *
 * A proxy in front of a rolling deploy — haven's locally, an ingress in
 * production — answers 502/503/504 with an empty body while the app behind it
 * is still coming up. A Response object exists, so this is not a transport
 * failure by the test above, but it carries no answer of OURS: no envelope, no
 * code, nothing the registry could look up. That is "nothing answered" wearing
 * an HTTP status, and it is the most common way a reader meets this screen.
 */
const NO_UPSTREAM_STATUSES = [502, 503, 504];

/**
 * Whether this failure never got an answer.
 *
 * Also true when the browser itself says it is offline, which is the one case
 * we can be certain about without inspecting anything.
 */
export function isServerUnreachable(error: unknown): boolean {
  if (!error) return false;

  // A SERVER THAT ANSWERED IS REACHABLE, whatever the browser thinks of the
  // network. This check used to sit BELOW the `onLine` shortcut, so in any
  // context where `onLine` reads false while HTTP still works — headless and
  // containerised browsers, some Linux setups — every named refusal on the
  // sign-in card was repainted as "we can't reach the server", which
  // discards the registry copy and starts an unbounded retry. On that card
  // the retried call is `auth.route`, whose budget is 60 an hour, so the
  // loop spent it in three minutes and then hammered a 429 for the rest of
  // the hour.
  if (carriesAResponse(error)) return false;

  // A PROXY ANSWERED; WE DID NOT. Below `carriesAResponse` on purpose, and the
  // order is the whole safety of it: our own upstream failures — `circuit_open`,
  // `gateway_unavailable`, `auth_upstream_unavailable`, `code_block_timeout` —
  // use these same statuses AND carry a code, so they are already gone by here
  // and keep their own, better copy. What is left is a gateway status with no
  // answer attached, which only an intermediary sends.
  const status = responseStatusOf(error);
  if (status !== null && NO_UPSTREAM_STATUSES.includes(status)) return true;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

  const message = messageOf(error);
  if (!message) return false;
  if (!TRANSPORT_FAILURES.some((phrase) => message.includes(phrase))) {
    return false;
  }

  return true;
}

function messageOf(error: unknown): string | null {
  if (typeof error === "string") return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    return typeof message === "string" ? message.toLowerCase() : null;
  }
  return null;
}

/**
 * Any trace of a reply. tRPC hangs the server's answer off `data`, and a
 * transport failure has none of it — no HTTP status, no code, no shape.
 */
/**
 * The status of the raw reply, when one arrived without a tRPC envelope.
 *
 * `data` is where tRPC puts an answer it could PARSE; a 502 with an empty body
 * has none, and the only trace of the reply is the Response the link hangs off
 * `meta` (`@trpc/client` 11: `meta: { response }`).
 */
function responseStatusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const { meta } = error as { meta?: unknown };
  if (!meta || typeof meta !== "object") return null;
  const { response } = meta as { response?: unknown };
  if (!response || typeof response !== "object") return null;
  const { status } = response as { status?: unknown };
  return typeof status === "number" ? status : null;
}

function carriesAResponse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { data } = error as { data?: unknown };
  if (typeof data !== "object" || data === null) return false;
  const { httpStatus, code } = data as {
    httpStatus?: unknown;
    code?: unknown;
  };
  return typeof httpStatus === "number" || typeof code === "string";
}
