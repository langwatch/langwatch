/**
 * The anonymous daily usage report a self-hosted install posts, and everything
 * that bounds it.
 *
 * Two routes call this one handler: `POST /api/track_usage` on the app host,
 * which every install has posted to since the worker existed, and
 * `POST /api/connect/v1/stats` on the connect host, which is where a connected
 * install posts instead. Identical handling is the point: an operator who
 * switches Connect on changes the host the report travels to and nothing else,
 * and neither route can drift from the other.
 *
 * Self-hosted instances present no credential here (see usageStatsWorker.ts),
 * so both routes stay public. What they accept is bounded instead:
 *   - a schema naming exactly the fields this release knows. Anything else is
 *     dropped before the report reaches PostHog, so a spoofed event can not
 *     smuggle arbitrary properties in even once it gets the event name right
 *   - a capped payload size
 *   - a global rate limit, the actual bound. `ip` and `instance_id` are both
 *     values the caller supplies, so an abuser rotates either one and lands
 *     in a fresh bucket every request (mirrors the reasoning in
 *     rum-ingest.service.ts). Checked first, on a fixed key, so a flood the
 *     global bucket is already refusing doesn't also mint a fresh per-caller
 *     Redis key on every request.
 *   - per-IP and per-instance limits on top, for fairness once under the cap
 */

import type { Context } from "hono";
import { z } from "zod";
import { getPostHogInstance } from "~/server/posthog";
import { rateLimit } from "~/server/rateLimit";
import { getClientIpFromHonoContext } from "~/utils/getClientIp";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const TRACK_USAGE_EVENT = "daily_usage_stats";

/** The report is small; anything larger is not one. */
export const TRACK_USAGE_MAX_BODY_BYTES = 10 * 1024;

// Every stat field is `.optional()`, and an unknown field is dropped rather
// than refused: this receiver is a stable contract that self-hosted instances
// at ANY version hit, including versions written after it. An older sender
// predating a field, and a newer one carrying a field this release has never
// heard of, both have to land.
//
// It used to be `.strict()`, which refused the newer sender outright. That is
// the failure this contract exists to prevent: the report is the only thing
// that tells us an install exists, so a rejected one takes the install with
// it, permanently and in both directions. Zod's default is to strip unknown
// keys, which closes the same security gap `.strict()` closed, because nothing
// outside the named set ever reaches PostHog. What the unknown keys leave
// behind is a count, so a receiver running behind its senders says so instead
// of looking healthy.
const trackUsageBodySchema = z.object({
  event: z.literal(TRACK_USAGE_EVENT),
  // The one field that stays required. Without it there is no install to
  // attribute the report to, and recording it against nothing is worse than
  // refusing it.
  instance_id: z.string().min(1).max(200),
  install_method: z.string().max(100).optional(),
  hostname: z.string().max(255).optional(),
  environment: z.string().max(50).optional(),
  totalTraces: z.number().optional(),
  totalScenarioEvents: z.number().optional(),
  annotations: z.number().optional(),
  annotationQueues: z.number().optional(),
  annotationQueueItems: z.number().optional(),
  annotationScores: z.number().optional(),
  batchEvaluations: z.number().optional(),
  customGraphs: z.number().optional(),
  datasets: z.number().optional(),
  datasetRecords: z.number().optional(),
  experiments: z.number().optional(),
  triggers: z.number().optional(),
  workflows: z.number().optional(),
  timestamp: z.string().optional(),
});

/**
 * How many fields the report carried that this release has no name for.
 *
 * Counted, never forwarded: the names are whatever the caller wrote. A count
 * above zero on real traffic means the senders are ahead of this receiver,
 * which is the thing to notice rather than the individual names.
 */
function countUnknownFields(body: unknown): number {
  if (typeof body !== "object" || body === null) return 0;
  const known = new Set(Object.keys(trackUsageBodySchema.shape));
  return Object.keys(body).filter((key) => !known.has(key)).length;
}

// A self-hosted instance sends this once per organization per day
// (usageStatsWorker.ts), so these ceilings stay generous for legitimate
// traffic while bounding abuse.
const TRACK_USAGE_GLOBAL_PER_MINUTE = 500;
const TRACK_USAGE_PER_IP_PER_MINUTE = 10;
const TRACK_USAGE_PER_INSTANCE_PER_HOUR = 5;

interface TrackUsageRateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

function toVerdict(result: {
  allowed: boolean;
  resetAt: number;
}): TrackUsageRateLimitVerdict {
  return {
    allowed: result.allowed,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    ),
  };
}

/**
 * Checked before the body is even parsed, on keys no request-body field can
 * influence, so a flood of malformed JSON is capped exactly like valid
 * traffic, an attacker can't dodge the limiter just by sending garbage.
 */
async function enforceGlobalAndIpRateLimit(
  ip: string,
): Promise<TrackUsageRateLimitVerdict> {
  const global = await rateLimit({
    key: "track_usage:global",
    windowSeconds: 60,
    max: TRACK_USAGE_GLOBAL_PER_MINUTE,
  });
  if (!global.allowed) return toVerdict(global);

  const perIp = await rateLimit({
    key: `track_usage:ip:${ip}`,
    windowSeconds: 60,
    max: TRACK_USAGE_PER_IP_PER_MINUTE,
  });
  return toVerdict(perIp);
}

async function enforceInstanceRateLimit(
  instanceId: string,
): Promise<TrackUsageRateLimitVerdict> {
  const perInstance = await rateLimit({
    key: `track_usage:instance:${instanceId}`,
    windowSeconds: 3600,
    max: TRACK_USAGE_PER_INSTANCE_PER_HOUR,
  });
  return toVerdict(perInstance);
}

/** Hono handler for the daily usage report, on either host. */
export async function handleTrackUsage(c: Context) {
  const ip = getClientIpFromHonoContext(c) ?? "unknown";

  const ipLimit = await enforceGlobalAndIpRateLimit(ip);
  if (!ipLimit.allowed) {
    c.header("Retry-After", String(ipLimit.retryAfterSeconds));
    return c.json({ message: "Too many requests" }, 429);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  const parsed = trackUsageBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ message: "Bad request" }, 400);
  }
  const { event, instance_id, ...properties } = parsed.data;
  const unknownFields = countUnknownFields(rawBody);

  const instanceLimit = await enforceInstanceRateLimit(instance_id);
  if (!instanceLimit.allowed) {
    c.header("Retry-After", String(instanceLimit.retryAfterSeconds));
    return c.json({ message: "Too many requests" }, 429);
  }

  const posthog = getPostHogInstance();
  if (posthog) {
    try {
      posthog.capture({
        distinctId: instance_id,
        event,
        properties: { ...properties, unknown_fields: unknownFields },
      });
    } catch (error) {
      captureException(toError(error));
    }
  }

  return c.json({ message: "Event captured" });
}
