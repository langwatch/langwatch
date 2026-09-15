/**
 * A failure that never reached the server at all — not a refusal, not a bug.
 * A false positive is worse than a false negative here: calling a real server
 * refusal "we can't reach the server" hides a fault we could have named. So a
 * failure only counts as unreachable when it has BOTH marks — a message that
 * matches a known browser transport failure, AND no sign of a response at all.
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
 * What an intermediary returns when it could not get an answer out of us: a
 * proxy in front of a rolling deploy (haven locally, an ingress in prod)
 * answers 502/503/504 with an empty body while the app behind it is still
 * coming up — "nothing answered" wearing an HTTP status.
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

  // A server that answered is reachable, whatever the browser thinks of the
  // network — this must run before the `onLine` shortcut below, because
  // `onLine` reads false while HTTP still works on some headless and
  // containerised browsers, which would otherwise repaint a named refusal.
  if (carriesAResponse(error)) return false;

  // Below `carriesAResponse` on purpose: our own upstream failures use these
  // same statuses AND carry a code, so they are already gone by here. What is
  // left is a gateway status with no answer attached, sent by an intermediary.
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
 * The status of the raw reply, when one arrived without a tRPC envelope.
 * `data` is where tRPC puts an answer it could parse; a 502 with an empty
 * body has none, so this reads the Response the link hangs off `meta`
 * (`@trpc/client` 11: `meta: { response }`) instead.
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
