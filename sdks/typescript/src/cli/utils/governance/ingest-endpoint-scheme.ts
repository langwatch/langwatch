/**
 * Whether an ingest endpoint will carry the key in the clear — decided once,
 * where the endpoint is chosen, since every wire reuses it. Warns rather
 * than refuses (a private network is real); loopback is exempt entirely.
 */

/** The IPv6 loopback address, in the two spellings a URL can carry. */
const LOOPBACK_V6 = new Set(["::1", "0:0:0:0:0:0:0:1"]);

/**
 * Whether posting the ingest key to `endpoint` sends it unencrypted. False
 * for https, loopback, or anything unparseable as a URL -- an unreadable
 * endpoint is refused elsewhere, and a warning naming nothing helps no one.
 */
export function sendsIngestKeyInClear(endpoint: string | undefined): boolean {
  if (!endpoint?.trim()) return false;
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  return !isLoopbackHost(url.hostname);
}

/**
 * Whether a URL hostname resolves to this machine: `localhost`, a
 * `127.0.0.0/8` address, `[::1]`, `.localhost` (RFC 6761 loopback), and the
 * IPv4-mapped IPv6 spelling `new URL()` normalises `[::ffff:127.0.0.1]` into.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (LOOPBACK_V6.has(host)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(host);
  if (mapped && Number.parseInt(mapped[1]!, 16) >>> 8 === 127) return true;
  return false;
}

/**
 * The one line a person reads when the key is about to travel in the clear.
 * Names the host, because a wiring command resolves an endpoint the user may
 * not have typed, and says what to do without claiming they cannot do this.
 */
export function cleartextIngestEndpointWarning(endpoint: string): string {
  return `the ingest key will travel unencrypted to ${safeHost(endpoint)}: ${endpoint} is plain http. Outside a private network, use an https endpoint.`;
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint.trim()).host;
  } catch {
    return "that host";
  }
}
