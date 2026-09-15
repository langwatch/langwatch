/**
 * Whether an ingest endpoint will carry the ingest key in the clear, and what
 * to say about it.
 *
 * The endpoint a tool is wired with is the one every wire that carries the key
 * uses: the agent's own OTel exporter posts the same bearer to it on every span
 * batch, and the session context hook posts its record beside them. So the
 * scheme is decided once, where the endpoint is chosen, rather than at each
 * caller. Nothing here refuses an endpoint: a self-hosted deployment on a
 * private network is a real setup, and a check that dropped its telemetry would
 * protect nothing while breaking attribution. It warns, and the run continues.
 *
 * Loopback is exempt. A key that never leaves the machine is not exposed by the
 * scheme, and local development is the reason plain http is reachable at all.
 *
 * Spec: specs/ai-governance/cli-wrappers/instrument-command.feature
 */

/** The IPv6 loopback address, in the two spellings a URL can carry. */
const LOOPBACK_V6 = new Set(["::1", "0:0:0:0:0:0:0:1"]);

/**
 * Whether posting the ingest key to `endpoint` sends it unencrypted to another
 * host. False for https, for loopback, and for anything that does not parse as
 * a URL: an endpoint we could not read is refused on its own merits elsewhere,
 * and a warning naming nothing helps no one.
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
 * Whether a URL hostname resolves to this machine. Covers the three forms a
 * person actually types (`localhost`, a `127.0.0.0/8` address, `[::1]`), the
 * `.localhost` names the local dev proxy hands out, which RFC 6761 reserves for
 * loopback, and the IPv4-mapped IPv6 spelling of a loopback address, which is
 * what `new URL()` normalises `[::ffff:127.0.0.1]` into.
 */
function isLoopbackHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
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
