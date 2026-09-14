import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { NextApiRequest } from "~/types/next-stubs";

interface DirectPeerRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

// Array of possible IP headers, in order of preference
const IP_HEADERS = [
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
];

/** Strips a port/whitespace and validates the result is a real IPv4/IPv6 address. */
function parseValidIp(ip: string): string | null {
  const cleanedIp =
    ip
      ?.split(",")[0]
      ?.replace(/^::ffff:/, "")
      .trim() ?? "";

  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

  if (ipv4Regex.test(cleanedIp) || ipv6Regex.test(cleanedIp)) {
    return cleanedIp;
  }
  return null;
}

export function getClientIp(
  req: NextApiRequest | undefined,
): string | undefined {
  if (!req) {
    return undefined;
  }

  // Check all headers
  for (const header of IP_HEADERS) {
    const value = req.headers[header];
    if (value) {
      if (Array.isArray(value)) {
        // If header has multiple values, take the first one
        const ip = parseValidIp(value[0] ?? "");
        if (ip) return ip;
      } else {
        const ip = parseValidIp(value);
        if (ip) return ip;
      }
    }
  }

  // Fallback to request socket
  if (req.socket?.remoteAddress) {
    const ip = parseValidIp(req.socket.remoteAddress);
    if (ip) return ip;
  }

  return undefined;
}

/**
 * The address of the process directly connected to this server.
 *
 * Unlike `getClientIp`, this deliberately ignores forwarding headers. Those
 * headers are caller-controlled until the deployment has an explicit trusted
 * proxy-hop policy, so public auth budgets must key only on the socket peer.
 */
export function getDirectPeerIp(
  req: DirectPeerRequest | undefined,
): string | undefined {
  const remoteAddress = req?.socket?.remoteAddress;
  if (!remoteAddress) return undefined;

  const normalized = remoteAddress.replace(/^::ffff:/, "").trim();
  return isIP(normalized) === 0 ? undefined : normalized;
}

/**
 * Resolves a rate-limit address without trusting caller-controlled headers.
 *
 * The socket peer is authoritative unless it is one of the deployment's own
 * hops. Only then is the canonical `x-forwarded-for` chain considered, walking
 * from right to left until the first hop that is not a hop itself. A generic
 * proxy is not evidence that a Cloudflare, Fastly, or other vendor-specific
 * header was sanitized, so those headers never participate in this
 * security-sensitive answer.
 */
export function getTrustedProxyClientIp(
  req: DirectPeerRequest | undefined,
  trustedProxies: readonly string[],
): string | undefined {
  const socketAddress = getDirectPeerIp(req);
  if (!socketAddress || !isInfrastructureHop(socketAddress, trustedProxies)) {
    return socketAddress;
  }

  return forwardedAddress(req?.headers ?? {}, trustedProxies) ?? socketAddress;
}

/**
 * Whether an address is one of the deployment's own hops rather than a caller.
 *
 * With `TRUSTED_PROXY_ADDRESSES` set the operator has answered this exactly,
 * and nothing outside the list is a hop.
 *
 * With nothing set the answer has to come from the address itself, and the one
 * thing an address proves is which side of the network boundary it sits on. A
 * private, loopback or link-local peer reached this process without crossing
 * the public internet, so it is something the operator runs - an ingress, a
 * service mesh, a sidecar. A public peer is a caller, whatever its headers say
 * about itself.
 *
 * That default is what keeps both failure modes off an unconfigured
 * deployment. Believing a public caller's own header would let it choose its
 * own rate-limit bucket; refusing to read a private ingress's header would
 * collapse every visitor behind that ingress into one bucket, which is a cap on
 * the installation rather than on an attacker. Naming the addresses is still
 * strictly better, and is the only way to narrow trust WITHIN a private
 * network, which is why the setting stays and the log line below asks for it.
 */
function isInfrastructureHop(
  address: string,
  trustedProxies: readonly string[],
): boolean {
  return trustedProxies.length > 0
    ? isTrustedProxy(address, trustedProxies)
    : isPrivateAddress(address);
}

/**
 * Ranges that cannot be reached from the public internet, so an address in one
 * of them belongs to the operator's own network.
 *
 * Carrier-grade NAT (100.64.0.0/10) is deliberately absent: it is unreachable
 * publicly, but it is where a mobile CARRIER puts its subscribers, so a peer in
 * it is a caller rather than a hop.
 */
const PRIVATE_IPV4_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",
] as const;

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return PRIVATE_IPV4_RANGES.some((range) => withinIpv4Range(address, range));
  }
  return isPrivateIpv6(address);
}

/** Loopback (`::1`), unique-local (`fc00::/7`) and link-local (`fe80::/10`). */
function isPrivateIpv6(address: string): boolean {
  if (isIP(address) !== 6) return false;

  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;

  const firstGroup = normalized.split(":")[0];
  if (!firstGroup) return false;

  const group = Number.parseInt(firstGroup, 16);
  if (Number.isNaN(group)) return false;

  return (group & 0xfe_00) === 0xfc_00 || (group & 0xff_c0) === 0xfe_80;
}

export function parseTrustedProxyAddresses(
  configured: string | undefined,
): readonly string[] {
  const entries = (configured ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.map(parseTrustedProxyEntry);
}

function parseTrustedProxyEntry(entry: string): string {
  const parts = entry.split("/");
  if (parts.length === 1) {
    const address = parseAddress(entry);
    if (address) return address;
  } else if (parts.length === 2) {
    const [network, prefix] = parts;
    const bits = parseIpv4Prefix(prefix);
    if (network && isIP(network) === 4 && bits !== null) {
      return `${network}/${bits}`;
    }
  }

  throw new Error(`Invalid trusted proxy address: ${entry}`);
}

function forwardedAddress(
  headers: Record<string, string | string[] | undefined>,
  trustedProxies: readonly string[],
): string | undefined {
  const value = headers["x-forwarded-for"];
  if (!value) return undefined;

  const hops = (Array.isArray(value) ? value.join(",") : value).split(",");
  for (let index = hops.length - 1; index >= 0; index--) {
    const address = parseAddress(hops[index] ?? "");
    if (!address) continue;
    if (!isInfrastructureHop(address, trustedProxies)) return address;
  }

  return undefined;
}

function parseAddress(value: string): string | undefined {
  const normalized = value.replace(/^\s*::ffff:/, "").trim();
  return isIP(normalized) === 0 ? undefined : normalized;
}

function isTrustedProxy(
  address: string,
  trustedProxies: readonly string[],
): boolean {
  return trustedProxies.some((entry) => {
    const configured = entry.trim();
    return configured.includes("/")
      ? withinIpv4Range(address, configured)
      : parseAddress(configured) === address;
  });
}

function withinIpv4Range(address: string, range: string): boolean {
  const parts = range.split("/");
  if (parts.length !== 2) return false;

  const [network, prefix] = parts;
  const bits = parseIpv4Prefix(prefix);
  if (!network || bits === null) return false;

  const target = ipv4AsNumber(address);
  const base = ipv4AsNumber(network);
  if (target === null || base === null) return false;

  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;
  return (target & mask) === (base & mask);
}

function parseIpv4Prefix(value: string | undefined): number | null {
  if (!value || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(value)) return null;
  return Number(value);
}

function ipv4AsNumber(address: string): number | null {
  if (isIP(address) !== 4) return null;

  return address
    .split(".")
    .map(Number)
    .reduce((total, octet) => ((total << 8) | octet) >>> 0, 0);
}

/**
 * Adapts a Hono request's headers into the `NextApiRequest` shape `getClientIp`
 * expects, so Hono routes can reuse the same header-priority IP resolution as
 * the legacy pages-router handlers instead of re-implementing it.
 *
 * When no proxy header is present, falls back to the raw socket address via
 * `getConnInfo` (populated by `@hono/node-server`'s `getRequestListener`,
 * see start.ts) rather than collapsing to "unknown" — without this, every
 * caller that skips proxy headers lands in the same rate-limit bucket.
 * `getConnInfo` reads `c.env.incoming`, which only `getRequestListener`
 * populates — Hono's `app.request()` test helper and other adapters leave
 * `c.env` empty, so this is wrapped defensively rather than assumed present.
 */
export function getClientIpFromHonoContext(c: Context): string | undefined {
  const fromHeaders = getClientIp({
    headers: c.req.header(),
  } as unknown as NextApiRequest);
  if (fromHeaders) return fromHeaders;

  try {
    const address = getConnInfo(c).remote.address;
    return address ? (parseValidIp(address) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The same answer as `getTrustedProxyClientIp`, asked of a Hono request.
 *
 * `getConnInfo` is the only place the socket peer survives the fetch-`Request`
 * boundary: a `Request` carries headers and nothing at all about the connection
 * that delivered it. Wrapped defensively for the reason
 * `getClientIpFromHonoContext` gives - `app.request()` and other adapters leave
 * `c.env` empty - and a peer we cannot read is treated as no peer, which leaves
 * the forwarding headers unread rather than believed.
 */
export function getTrustedProxyClientIpFromHonoContext(
  c: Context,
  trustedProxies: readonly string[],
): string | undefined {
  let remoteAddress: string | undefined;
  try {
    remoteAddress = getConnInfo(c).remote.address;
  } catch {
    remoteAddress = undefined;
  }

  return getTrustedProxyClientIp(
    { headers: c.req.header(), socket: { remoteAddress } },
    trustedProxies,
  );
}
