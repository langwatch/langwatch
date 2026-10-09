import { Counter, register } from "prom-client";

// Remove existing metrics if they exist (for hot reload)
const metricNames = ["rate_limit_exceeded_total"] as const;

for (const name of metricNames) {
  register.removeSingleMetric(name);
}

/**
 * `rateLimit()` (`rateLimit.ts`) returning `{ allowed: false }` — a caller hit
 * its window's `max` on either the Redis or the in-memory backend. The caller
 * already gets the denial in its own return value; this is what lets an
 * operator see the shape of the traffic hitting a limit fleet-wide, without
 * grepping per-request logs for one.
 *
 * `scope` is the segment of the key before its first `:` (keys look like
 * `auth.route:addr:<sha256>`, so `scope` is `auth.route`) — the caller that
 * chose the limit, never the address or hash that follows it. A sustained
 * climb on one scope names which surface to look at; a spike across every
 * scope at once points at something shared (Redis latency, a bot run) rather
 * than one endpoint.
 */
export const rateLimitExceededTotal = new Counter({
  name: "rate_limit_exceeded_total",
  help: "Rate-limit checks that returned allowed: false, by the calling scope (the key segment before its first ':')",
  labelNames: ["scope"] as const,
});
