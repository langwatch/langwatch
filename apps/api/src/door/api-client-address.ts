import { getConnInfo } from "@hono/node-server/conninfo";
import type { TrpcRequestLike } from "@langwatch/api/trpc";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { isIP } from "node:net";

import { configuredTrustedProxies } from "./api-trusted-proxies.ts";

const logger = createLogger("langwatch:api:client-address");

/**
 * Which address a request came from: the socket, unless the request arrived
 * from one of this deployment's own hops.
 */
export function apiClientAddress(
  c: Context,
  options?: { trustedProxies?: readonly string[] },
): string | undefined {
  const socketAddress = apiSocketAddress(c);
  announceUndeclaredPublicProxyOnce({
    forwardedFor: c.req.header("x-forwarded-for"),
    socketAddress,
    trusted: options?.trustedProxies ?? configuredTrustedProxies(),
  });
  return clientAddressOf({
    header: (name) => c.req.header(name),
    socketAddress,
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
  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    return Array.isArray(value) ? value.join(",") : value;
  };
  announceUndeclaredPublicProxyOnce({
    forwardedFor: header("x-forwarded-for"),
    socketAddress: req.socket?.remoteAddress,
    trusted: options?.trustedProxies ?? configuredTrustedProxies(),
  });
  return clientAddressOf({
    header,
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
  if (socket === undefined || !isInfrastructureHop(socket, trusted)) {
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

/**
 * Said once, not once per request: this is a deployment fact, and repeating it
 * on a hot path would bury the thing it is trying to point at.
 */
let announcedUndeclaredPublicProxy = false;

/**
 * A proxy on a public address nobody declared: a private hop is recognised,
 * but a public one is indistinguishable from a caller, so every visitor
 * behind it shares one signed-out budget. Only `TRUSTED_PROXY_ADDRESSES` tells them apart.
 */
function announceUndeclaredPublicProxyOnce(input: {
  forwardedFor: string | undefined;
  socketAddress: string | undefined;
  trusted: readonly string[] | undefined;
}): void {
  if (announcedUndeclaredPublicProxy) return;
  if (input.trusted !== undefined && input.trusted.length > 0) return;
  if (!input.forwardedFor) return;

  const peer = input.socketAddress ? parseAddress(input.socketAddress) : null;
  if (peer === null || isPrivateAddress(peer)) return;

  announcedUndeclaredPublicProxy = true;
  logger.warn(
    { setting: "TRUSTED_PROXY_ADDRESSES" },
    "Ignored a forwarded-for header from a public peer, so signed-out authentication limits are counting that peer rather than the caller behind it. If it is this deployment's proxy, name it in TRUSTED_PROXY_ADDRESSES.",
  );
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

/** The rightmost hop no trusted proxy wrote, across the forwarding headers. */
function forwardedAddress(
  header: (name: string) => string | undefined,
  trusted: readonly string[] | undefined,
): string | undefined {
  for (const name of ADDRESS_HEADERS) {
    const value = header(name);
    if (!value) continue;
    const hops = value.split(",");
    for (let index = hops.length - 1; index >= 0; index--) {
      const address = parseAddress(hops[index] ?? "");
      if (address === null) continue;
      if (!isInfrastructureHop(address, trusted)) return address;
    }
  }
  return undefined;
}

/** One address, or nothing when the text is not one. */
function parseAddress(value: string): string | null {
  const address = value.replace(/^\s*::ffff:/, "").trim();
  return isIP(address) === 0 ? null : address;
}

/**
 * Whether an address is this deployment's own hop rather than a caller. With
 * the setting present, the operator has answered exactly; absent, a private
 * peer counts as infrastructure — the default keeping visitors from sharing one budget.
 */
function isInfrastructureHop(address: string, trusted: readonly string[] | undefined): boolean {
  if (trusted === undefined) return isPrivateAddress(address);
  return trusted.some((entry) =>
    entry.includes("/") ? withinIpv4Range(address, entry) : entry === address,
  );
}

/**
 * Ranges unreachable from the public internet, so an address in one belongs
 * to the operator's own network. Carrier-grade NAT (100.64.0.0/10) is
 * deliberately absent: mobile CARRIERs put subscribers there, so it's a caller, not a hop.
 */
const PRIVATE_IPV4_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",
] as const;

function isPrivateAddress(address: string): boolean {
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

/** IPv4 prefix membership; anything unparsable matches nothing. */
function withinIpv4Range(address: string, range: string): boolean {
  const [network, prefix] = range.split("/");
  const bits = Number(prefix);
  const hasValidPrefix = network !== undefined && Number.isInteger(bits) && bits >= 0 && bits <= 32;
  if (!hasValidPrefix) return false;

  const target = ipv4AsNumber(address);
  const base = ipv4AsNumber(network);
  if (target === null || base === null) return false;

  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;
  return (target & mask) === (base & mask);
}

function ipv4AsNumber(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets.reduce((total, octet) => ((total << 8) | octet) >>> 0, 0);
}
