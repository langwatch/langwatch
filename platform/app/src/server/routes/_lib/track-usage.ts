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
 *
 * An accepted report lands in two places: the registry of self-hosted installs
 * (one row per install, plus the report itself as history), and PostHog. The
 * registry is what a screen reads back; before it, the report reached PostHog
 * and no database, so no question about our own distribution could be
 * answered. Because the caller presents no credential, a report identifies an
 * install and never a customer: the organization on an install's row comes
 * from the license bound to that instance, never from the posted body.
 */

import { createSelfHostedInstanceService } from "@ee/telemetry/instances/composition";
import type { Context } from "hono";
import { z } from "zod";
import { prisma } from "~/server/db";
import { getPostHogInstance } from "~/server/posthog";
import { rateLimit } from "~/server/rateLimit";
import { getClientIpFromHonoContext } from "~/utils/getClientIp";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const TRACK_USAGE_EVENT = "daily_usage_stats";

/**
 * A rung of the onboarding ladder: the day it was first reached, or null on
 * one this install never reached. Null is a value here, not a missing field.
 */
const ladderDate = z.string().max(40).nullable().optional();

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
  // The standard block, which every report carries.
  report_schema_version: z.number().optional(),
  version: z.string().max(100).optional(),
  install_method: z.string().max(100).optional(),
  chart_version: z.string().max(100).nullable().optional(),
  hostname: z.string().max(255).nullable().optional(),
  environment: z.string().max(50).optional(),
  first_seen_at: z.string().max(40).nullable().optional(),
  timestamp: z.string().max(40).optional(),

  // The operational block: what it takes to run the service for a customer.
  organizations: z.number().optional(),
  teams: z.number().optional(),
  projects: z.number().optional(),
  users: z.number().optional(),
  auth_method: z.string().max(50).optional(),
  sso_provider: z.string().max(50).nullable().optional(),
  connected: z.boolean().optional(),

  // Who runs it. Domains with counts, never an address.
  user_email_domains: z.record(z.string().max(255), z.number()).optional(),

  // The onboarding ladder. Null on a rung this install never reached, which
  // is the half of the answer worth having.
  first_project_at: ladderDate,
  first_member_at: ladderDate,
  first_dataset_at: ladderDate,
  first_evaluation_at: ladderDate,
  first_monitor_at: ladderDate,
  first_prompt_at: ladderDate,
  first_workflow_at: ladderDate,
  first_model_provider_at: ladderDate,
  first_annotation_at: ladderDate,
  first_trigger_at: ladderDate,
  first_experiment_at: ladderDate,

  // What they do. Lifetime, and over the two windows that make a lifetime
  // total mean something.
  totalTraces: z.number().optional(),
  traces_7d: z.number().optional(),
  traces_28d: z.number().optional(),
  totalScenarioEvents: z.number().optional(),
  scenario_runs_7d: z.number().optional(),
  scenario_runs_28d: z.number().optional(),
  annotations: z.number().optional(),
  annotations_7d: z.number().optional(),
  annotations_28d: z.number().optional(),
  annotationQueues: z.number().optional(),
  annotationQueueItems: z.number().optional(),
  annotationScores: z.number().optional(),
  batchEvaluations: z.number().optional(),
  batch_evaluations_7d: z.number().optional(),
  batch_evaluations_28d: z.number().optional(),
  customGraphs: z.number().optional(),
  datasets: z.number().optional(),
  datasets_7d: z.number().optional(),
  datasets_28d: z.number().optional(),
  datasetRecords: z.number().optional(),
  dataset_records_7d: z.number().optional(),
  dataset_records_28d: z.number().optional(),
  experiments: z.number().optional(),
  experiments_7d: z.number().optional(),
  experiments_28d: z.number().optional(),
  prompts: z.number().optional(),
  prompts_7d: z.number().optional(),
  prompts_28d: z.number().optional(),
  monitors: z.number().optional(),
  monitors_7d: z.number().optional(),
  monitors_28d: z.number().optional(),
  triggers: z.number().optional(),
  triggers_7d: z.number().optional(),
  triggers_28d: z.number().optional(),
  workflows: z.number().optional(),
  workflows_7d: z.number().optional(),
  workflows_28d: z.number().optional(),
  active_users_28d: z.number().optional(),
  active_projects_28d: z.number().optional(),

  // How they run it. Names only, never a key and never an endpoint.
  model_providers: z.array(z.string().max(50)).max(50).optional(),
  storage_backend: z.string().max(50).optional(),
  email_configured: z.boolean().optional(),
  gateway_configured: z.boolean().optional(),
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

  await storeReport({
    instanceId: instance_id,
    properties,
    unknownFields,
  });

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

/**
 * The report's own row, and one row of history (ADR-139, section 10).
 *
 * A failure here is swallowed, exactly as the PostHog capture's is, and for
 * the same reason: refusing a report takes the install with it. An install
 * that gets a 500 back logs a failed report and tries again tomorrow, and a
 * receiver that is briefly unable to write would turn a day of storage trouble
 * into a gap in every install's history. The failure reaches error tracking
 * instead.
 *
 * The organization an install belongs to is resolved inside the service, from
 * the license bound to that instance. Nothing in `properties` reaches it.
 */
async function storeReport({
  instanceId,
  properties,
  unknownFields,
}: {
  instanceId: string;
  properties: Record<string, unknown>;
  unknownFields: number;
}): Promise<void> {
  try {
    await createSelfHostedInstanceService(prisma).recordReport({
      instanceId,
      properties,
      unknownFields,
      receivedAt: new Date(),
    });
  } catch (error) {
    captureException(toError(error));
  }
}
