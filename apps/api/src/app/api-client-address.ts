import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Which address a request came from, as this process can answer it.
 *
 * The header list and its ORDER are the deployment's, not a preference: a
 * request that traversed Cloudflare carries the real client in
 * `cf-connecting-ip` and a proxy-supplied chain in `x-forwarded-for`, so
 * reading the chain first would bucket every Cloudflare caller by whatever
 * they chose to put in it. The first header present that parses as an address
 * wins; the raw socket address is the fallback.
 *
 * Falling back to the socket matters as much as the headers do. Without it
 * every caller that sends no proxy header lands in ONE rate-limit bucket, so
 * the first of them to spend the window locks out all the rest.
 *
 * `getConnInfo` reads `c.env.incoming`, which only the Node server's request
 * listener populates — Hono's own `app.request()` helper and other adapters
 * leave `c.env` empty — so it is guarded rather than assumed.
 *
 * This IS the collapse. `platform/app/src/utils/getClientIp.ts` was the other
 * reading of the same header list, and it was deleted rather than moved here:
 * its Hono half answered this exact question with the same header order and
 * the same socket fallback, and its `NextApiRequest` half reads a request
 * shape this process never sees. Its suite came with it —
 * `__tests__/api-client-address.unit.test.ts` now drives this function — so
 * the header order, the fallback and the two ways it can answer nothing are
 * pinned here rather than in a module that no longer exists.
 */
export function apiClientAddress(c: Context): string | undefined {
  for (const header of ADDRESS_HEADERS) {
    const value = c.req.header(header);
    if (!value) continue;
    const address = parseAddress(value);
    if (address) return address;
  }

  try {
    const remote = getConnInfo(c).remote.address;
    return remote ? (parseAddress(remote) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/** In order of preference; the first that parses wins. */
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

/**
 * The first hop of a header value, as an address or nothing.
 *
 * Validated rather than trusted: the value is caller-supplied on every header
 * above, and an unvalidated one becomes a rate-limit key an attacker chooses.
 */
function parseAddress(value: string): string | null {
  const first =
    value
      .split(",")[0]
      ?.replace(/^::ffff:/, "")
      .trim() ?? "";
  return IPV4.test(first) || IPV6.test(first) ? first : null;
}
