import { getConnInfo } from "@hono/node-server/conninfo";
import type { TrpcRequestLike } from "@langwatch/api/trpc";
import { RuntimeConfig, trustedProxyConfigDefinition } from "@langwatch/config";
import type { Context } from "hono";

/**
 * Which address a request came from: the socket, unless the request arrived
 * from a hop named in `TRUSTED_PROXY_ADDRESSES` (empty by default). A
 * forwarding header is written by whoever sent the request, and every IP-keyed
 * throttle here is keyed on this, so a trusted hop's chain is read from the
 * RIGHT and an untrusted one's is not read at all.
 */
export function apiClientAddress(
  c: Context,
  options?: { trustedProxies?: readonly string[] },
): string | undefined {
  return clientAddressOf({
    header: (name) => c.req.header(name),
    socketAddress: apiSocketAddress(c),
    ...(options?.trustedProxies ? { trustedProxies: options.trustedProxies } : {}),
  });
}

/**
 * The same answer for a caller holding the tRPC context's request rather than
 * a Hono one — one resolver, so a per-IP limit on the tRPC surface and one on
 * a REST route cannot disagree about who is calling.
 */
export function trpcClientAddress(
  req: TrpcRequestLike | undefined,
  options?: { trustedProxies?: readonly string[] },
): string | undefined {
  if (!req) return undefined;
  return clientAddressOf({
    header: (name) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value.join(",") : value;
    },
    socketAddress: req.socket?.remoteAddress,
    ...(options?.trustedProxies ? { trustedProxies: options.trustedProxies } : {}),
  });
}

function clientAddressOf(input: {
  header: (name: string) => string | undefined;
  socketAddress: string | undefined;
  trustedProxies?: readonly string[];
}): string | undefined {
  const trusted = input.trustedProxies ?? configuredTrustedProxies();
  const socket = input.socketAddress ? (parseAddress(input.socketAddress) ?? undefined) : undefined;
  if (socket === undefined || !isTrustedProxy(socket, trusted)) {
    return socket;
  }
  return forwardedAddress(input.header, trusted) ?? socket;
}

/** The raw peer, before any header is considered. */
export function apiSocketAddress(c: Context): string | undefined {
  try {
    const remote = getConnInfo(c).remote.address;
    return remote ? (parseAddress(remote) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/** In order of preference; the first that yields an untrusted hop wins. */
const ADDRESS_HEADERS = [
  "cf-connecting-ip", // Cloudflare
  "x-forwarded-for", // AWS ELB and general proxy
  "x-forwarded", // AWS ELB
  "x-real-ip", // Nginx proxy
  "x-client-ip", // Apache
  "forwarded-for", // General forwarded header
  "forwarded", // General forwarded header
  "true-client-ip", // Akamai and Cloudflare
  "x-cluster-client-ip", // Rackspace LB, Riverbed Stingray
  "fastly-client-ip", // Fastly CDN
] as const;

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

/** The rightmost hop no trusted proxy wrote, across the forwarding headers. */
function forwardedAddress(
  header: (name: string) => string | undefined,
  trusted: readonly string[],
): string | undefined {
  for (const name of ADDRESS_HEADERS) {
    const value = header(name);
    if (!value) continue;
    const hops = value.split(",");
    for (let index = hops.length - 1; index >= 0; index--) {
      const address = parseAddress(hops[index] ?? "");
      if (address === null) continue;
      if (!isTrustedProxy(address, trusted)) return address;
    }
  }
  return undefined;
}

/** One address, or nothing when the text is not one. */
function parseAddress(value: string): string | null {
  const address = value.replace(/^\s*::ffff:/, "").trim();
  return IPV4.test(address) || IPV6.test(address) ? address : null;
}

function isTrustedProxy(address: string, trusted: readonly string[]): boolean {
  return trusted.some((entry) =>
    entry.includes("/") ? withinIpv4Range(address, entry) : entry === address,
  );
}

/** IPv4 prefix membership; anything unparsable matches nothing. */
function withinIpv4Range(address: string, range: string): boolean {
  const [network, prefix] = range.split("/");
  const bits = Number(prefix);
  if (network === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const target = ipv4AsNumber(address);
  const base = ipv4AsNumber(network);
  if (target === null || base === null) return false;

  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;
  return (target & mask) === (base & mask);
}

function ipv4AsNumber(address: string): number | null {
  if (!IPV4.test(address)) return null;
  const octets = address.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets.reduce((total, octet) => ((total << 8) | octet) >>> 0, 0);
}

let cached: { raw: string | undefined; value: readonly string[] } | undefined;

/**
 * Read here rather than threaded from the composition root: this reader is
 * handed a Hono context and nothing else, and the list is one process-wide
 * deployment fact. Re-resolved only when the variable itself changes.
 */
function configuredTrustedProxies(): readonly string[] {
  const raw = process.env.TRUSTED_PROXY_ADDRESSES;
  if (cached !== undefined && cached.raw === raw) return cached.value;

  const configured = RuntimeConfig.create({
    name: "api trusted proxies",
    definition: trustedProxyConfigDefinition,
    source: process.env,
  }).value.trustedProxies;
  const value = (configured ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  cached = { raw, value };
  return value;
}
