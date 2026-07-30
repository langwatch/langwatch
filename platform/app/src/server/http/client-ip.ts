import type { Context } from "hono";

/**
 * The caller's address, as far as anything downstream of our own proxy can
 * know it.
 *
 * `x-forwarded-for` is a list that each hop appends to, so only the entry
 * nearest us was written by a machine we control — every earlier one is
 * whatever the client chose to send. Reading the LAST entry is what stops a
 * forged header from picking the caller's own rate-limit bucket.
 *
 * Returns null rather than a placeholder when there is no usable address, so
 * callers decide explicitly whether that means "skip this axis" or "deny";
 * a shared `"unknown"` bucket silently meters every such caller against every
 * other one.
 */
export function nearestHopIp(c: Context): string | null {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const nearest = hops[hops.length - 1]?.trim();
    if (nearest) return nearest;
  }
  return c.req.header("x-real-ip")?.trim() ?? null;
}
