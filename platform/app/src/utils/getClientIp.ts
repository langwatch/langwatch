import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { NextApiRequest } from "~/types/next-stubs";

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
