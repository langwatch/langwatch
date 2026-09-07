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
 * The socket peer is authoritative unless the operator explicitly names it
 * as a trusted proxy. Only then is the canonical `x-forwarded-for` chain
 * considered, walking from right to left until the first hop that is not
 * itself trusted. A generic proxy is not evidence that a Cloudflare, Fastly,
 * or other vendor-specific header was sanitized, so those headers never
 * participate in this security-sensitive answer.
 */
export function getTrustedProxyClientIp(
  req: DirectPeerRequest | undefined,
  trustedProxies: readonly string[],
): string | undefined {
  const socketAddress = getDirectPeerIp(req);
  if (!socketAddress || !isTrustedProxy(socketAddress, trustedProxies)) {
    return socketAddress;
  }

  return forwardedAddress(req?.headers ?? {}, trustedProxies) ?? socketAddress;
}

export function parseTrustedProxyAddresses(
  configured: string | undefined,
): readonly string[] {
  return (configured ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
    if (!isTrustedProxy(address, trustedProxies)) return address;
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
  const [network, prefix] = range.split("/");
  const bits = Number(prefix);
  if (!network || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }

  const target = ipv4AsNumber(address);
  const base = ipv4AsNumber(network);
  if (target === null || base === null) return false;

  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;
  return (target & mask) === (base & mask);
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
