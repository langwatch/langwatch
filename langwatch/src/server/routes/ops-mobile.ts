/**
 * Mobile ops API — plain-JSON transport in front of the existing ops surfaces,
 * for the native iOS client in `ios/`.
 *
 * WHY THIS EXISTS. Every ops surface today is a tRPC procedure authenticated by
 * a browser session cookie and encoded with superjson. A native app can hold
 * neither comfortably: the cookie belongs to a web session it does not have, and
 * the envelope is a decoder to maintain for no benefit. So this is a second
 * transport, not a second implementation — the handlers call
 * {@link MobileOpsService}, which delegates to the same app-layer services the
 * tRPC router calls, and the authorization decision is the same
 * `resolveOpsScope` used by `checkOpsPermission`.
 *
 * AUTH. `Authorization: Bearer lw_at_…`, the access token minted by the RFC 8628
 * device-authorization flow in `auth-cli.ts` and validated by the shared
 * `validateCliAccessToken`. Session cookies are deliberately NOT accepted: a
 * browser that happens to be signed in must not be able to reach this surface
 * cross-origin, and there is nothing here a browser needs that the web UI does
 * not already have.
 *
 * WHAT IS ABSENT, ON PURPOSE. Unblock, drain, redrive, DLQ moves, tenant and
 * pipeline pauses, feature-flag writes, single-blob deletes, and starting or
 * cancelling a projection replay. A phone in a pocket is the wrong place to
 * hold a control that redrives a queue or rebuilds a projection, and the
 * absence of those routes is a security property of this file rather than an
 * unfinished list. The one write is the payload-store sweep, which an operator
 * trials with `dryRun` before running for real behind a typed confirmation.
 *
 * Spec: specs/ops/mobile-ops-api.feature
 */
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { z } from "zod";

import { resolveOpsScope } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import {
  MobileOpsService,
  OpsModuleUnavailableError,
} from "~/server/app-layer/ops/mobile-ops.service";
import { OPS_BLOB_SORTS } from "~/server/app-layer/ops/types";
import { validateCliAccessToken } from "~/server/auth/cliAccessToken";
import { prisma } from "~/server/db";
import { connection as redisConnection } from "~/server/redis";

const logger = createLogger("langwatch:ops:mobile");

const secured = createServiceApp({ basePath: "/api/ops/mobile" });

const MOBILE_OPS_POLICY = handlerManagedAuth(
  "Device-flow bearer token validated in-handler, then gated on the ops:view / ops:manage scope via resolveOpsScope",
);

/** Resolved caller: who they are and what ops scope they hold. */
interface OpsCaller {
  userId: string;
  email: string | null;
  hasOpsAccess: boolean;
}

/**
 * Resolve the bearer token to a user and their ops scope.
 *
 * Returns null when the token is missing, malformed, expired or points at a
 * user that no longer exists — every one of those is a 401, and collapsing them
 * into one answer is deliberate: telling a caller which of the four it was is
 * free information for someone probing tokens.
 */
async function resolveCaller(c: Context): Promise<OpsCaller | null> {
  if (!redisConnection) return null;

  const record = await validateCliAccessToken({
    authHeader: c.req.header("authorization"),
    redis: redisConnection,
  });
  if (!record) return null;

  const user = await prisma.user.findUnique({
    where: { id: record.user_id },
    select: { id: true, email: true },
  });
  if (!user) return null;

  // No impersonator branch: a device-flow token is minted for one identity and
  // carries no "acting as" concept, so unlike the tRPC path there is no second
  // email to resolve the grant against.
  const scope = resolveOpsScope({
    userId: user.id,
    userEmail: user.email,
    permission: "ops:view",
    prisma,
  });

  return {
    userId: user.id,
    email: user.email,
    hasOpsAccess: scope.kind !== "none",
  };
}

/**
 * Guard for every data route: 401 without a valid token, 403 without ops
 * access. Returns the caller when both pass.
 */
async function requireOpsCaller(
  c: Context,
): Promise<
  { ok: true; caller: OpsCaller } | { ok: false; response: Response }
> {
  const caller = await resolveCaller(c);
  if (!caller) {
    return {
      ok: false,
      response: c.json({ message: "Unauthorized" }, 401),
    };
  }
  if (!caller.hasOpsAccess) {
    return {
      ok: false,
      response: c.json(
        { message: "You do not have permission to access ops resources" },
        403,
      ),
    };
  }
  return { ok: true, caller };
}

function mobileOpsService(): MobileOpsService {
  const ops = getApp().ops;
  if (!ops) throw new OpsModuleUnavailableError();
  return new MobileOpsService(ops, redisConnection ?? null);
}

/**
 * Wrap a handler with the auth guard and the ops-module check, so every route
 * below reads as the query it performs rather than as four lines of preamble.
 * A missing ops module is a 503 with an explanation, never an empty payload
 * that a client would render as a healthy platform.
 */
function opsRoute(
  handler: (args: {
    c: Context;
    service: MobileOpsService;
    caller: OpsCaller;
  }) => Promise<Response> | Response,
) {
  return async (c: Context) => {
    const guard = await requireOpsCaller(c);
    if (!guard.ok) return guard.response;

    try {
      return await handler({ c, service: mobileOpsService(), caller: guard.caller });
    } catch (err) {
      if (err instanceof OpsModuleUnavailableError) {
        return c.json({ message: err.message, opsModuleAvailable: false }, 503);
      }
      throw err;
    }
  };
}

/** Parse a query string against a schema, answering 400 with the first issue. */
function parseQuery<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): { ok: true; data: z.infer<T> } | { ok: false; response: Response } {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      response: c.json(
        { message: `${path}${issue?.message ?? "invalid query"}` },
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

// ---------------------------------------------------------------------------
// Scope probe
//
// The one route that answers for a caller with no ops access, mirroring
// `ops.getScope`: the app needs to distinguish "your account cannot see ops"
// from "the network failed", and a 403 on first launch reads as the latter.
// ---------------------------------------------------------------------------

secured.access(MOBILE_OPS_POLICY).get("/scope", async (c) => {
  const caller = await resolveCaller(c);
  if (!caller) return c.json({ message: "Unauthorized" }, 401);
  return c.json({
    userId: caller.userId,
    email: caller.email,
    hasOpsAccess: caller.hasOpsAccess,
    opsModuleAvailable: !!getApp().ops,
  });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

secured
  .access(MOBILE_OPS_POLICY)
  .get("/dashboard", opsRoute(({ c, service }) => c.json(service.getDashboard())));

secured
  .access(MOBILE_OPS_POLICY)
  .get("/badge", opsRoute(({ c, service }) => c.json(service.getBadgeCounts())));

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

secured.access(MOBILE_OPS_POLICY).get(
  "/queues",
  opsRoute(async ({ c, service }) => c.json({ queues: await service.getQueues() })),
);

const groupsQuerySchema = z.object({
  queueName: z.string().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

secured.access(MOBILE_OPS_POLICY).get(
  "/groups",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, groupsQuerySchema);
    if (!query.ok) return query.response;
    return c.json(await service.getGroups(query.data));
  }),
);

const groupDetailQuerySchema = z.object({
  queueName: z.string().min(1).max(200),
  groupId: z.string().min(1).max(500),
});

secured.access(MOBILE_OPS_POLICY).get(
  "/group",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, groupDetailQuerySchema);
    if (!query.ok) return query.response;
    const group = await service.getGroupDetail(query.data);
    if (!group) return c.json({ message: "Group not found" }, 404);
    return c.json({ group });
  }),
);

const groupJobsQuerySchema = groupDetailQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

secured.access(MOBILE_OPS_POLICY).get(
  "/group-jobs",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, groupJobsQuerySchema);
    if (!query.ok) return query.response;
    return c.json(await service.getGroupJobs(query.data));
  }),
);

secured.access(MOBILE_OPS_POLICY).get(
  "/blocked-summary",
  opsRoute(async ({ c, service }) => c.json(await service.getBlockedSummary())),
);

const queueNameQuerySchema = z.object({
  queueName: z.string().min(1).max(200),
});

secured.access(MOBILE_OPS_POLICY).get(
  "/paused-keys",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, queueNameQuerySchema);
    if (!query.ok) return query.response;
    return c.json({ keys: await service.getPausedKeys(query.data) });
  }),
);

secured.access(MOBILE_OPS_POLICY).get(
  "/paused-tenants",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, queueNameQuerySchema);
    if (!query.ok) return query.response;
    return c.json({ tenants: await service.getPausedTenants(query.data) });
  }),
);

// ---------------------------------------------------------------------------
// Dead letters and anomalies
// ---------------------------------------------------------------------------

secured.access(MOBILE_OPS_POLICY).get(
  "/dlq",
  opsRoute(async ({ c, service }) => c.json({ groups: await service.getDlqGroups() })),
);

secured.access(MOBILE_OPS_POLICY).get(
  "/anomalies",
  opsRoute(async ({ c, service }) =>
    c.json({ anomalies: await service.getAnomalies() }),
  ),
);

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const schedulerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

secured.access(MOBILE_OPS_POLICY).get(
  "/scheduler",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, schedulerQuerySchema);
    if (!query.ok) return query.response;
    return c.json({ jobs: await service.getScheduledJobs(query.data) });
  }),
);

// ---------------------------------------------------------------------------
// The Foundry — catalog only
// ---------------------------------------------------------------------------

secured.access(MOBILE_OPS_POLICY).get(
  "/foundry/presets",
  opsRoute(({ c, service }) => c.json({ presets: service.getFoundryPresets() })),
);

// ---------------------------------------------------------------------------
// Payload store
// ---------------------------------------------------------------------------

secured.access(MOBILE_OPS_POLICY).get(
  "/blobs/stats",
  opsRoute(async ({ c, service }) => c.json(await service.getBlobStoreStats())),
);

const blobsQuerySchema = z.object({
  queueName: z.string().min(1).max(200),
  cursor: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  projectId: z.string().max(200).optional(),
  sort: z.enum(OPS_BLOB_SORTS).default("largest"),
});

secured.access(MOBILE_OPS_POLICY).get(
  "/blobs",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, blobsQuerySchema);
    if (!query.ok) return query.response;
    return c.json(
      await service.getBlobs({
        queueName: query.data.queueName,
        cursor: query.data.cursor ?? null,
        limit: query.data.limit,
        projectId: query.data.projectId ?? null,
        sort: query.data.sort,
      }),
    );
  }),
);

const blobQuerySchema = z.object({
  queueName: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  hash: z.string().min(1).max(200),
});

secured.access(MOBILE_OPS_POLICY).get(
  "/blob",
  opsRoute(async ({ c, service }) => {
    const query = parseQuery(c, blobQuerySchema);
    if (!query.ok) return query.response;
    const blob = await service.getBlob(query.data);
    if (!blob) return c.json({ message: "Blob not found" }, 404);
    return c.json({ blob });
  }),
);

/**
 * The sweep. `dryRun` defaults to true so a malformed body can only ever
 * trial — the destructive form has to be asked for twice, once by setting the
 * flag and once by typing the confirmation.
 */
const sweepBodySchema = z.object({
  dryRun: z.boolean().default(true),
  confirm: z.literal("RECLAIM").optional(),
});

secured.access(MOBILE_OPS_POLICY).post(
  "/blobs/sweep",
  opsRoute(async ({ c, service, caller }) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = sweepBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ message: "Invalid request body" }, 400);
    }

    if (!parsed.data.dryRun && parsed.data.confirm !== "RECLAIM") {
      return c.json(
        { message: "This action needs to be confirmed before it can run" },
        400,
      );
    }

    const report = await service.runBlobSweep({
      dryRun: parsed.data.dryRun,
      // Opaque id, not email: the audit trail must trace the actor without
      // carrying PII into the log stream.
      requestedBy: caller.userId,
    });

    logger.info(
      {
        dryRun: parsed.data.dryRun,
        reclaimed: report.totals.reclaimed,
        requestedBy: caller.userId,
      },
      "Payload store sweep requested from the mobile ops client",
    );

    return c.json(report);
  }),
);

// ---------------------------------------------------------------------------
// Projections — readable, never startable
// ---------------------------------------------------------------------------

secured.access(MOBILE_OPS_POLICY).get(
  "/projections",
  opsRoute(({ c, service }) => c.json(service.getProjections())),
);

secured.access(MOBILE_OPS_POLICY).get(
  "/replay/status",
  opsRoute(async ({ c, service }) => c.json(await service.getReplayStatus())),
);

secured.access(MOBILE_OPS_POLICY).get(
  "/replay/history",
  opsRoute(async ({ c, service }) =>
    c.json({ history: await service.getReplayHistory() }),
  ),
);

secured.access(MOBILE_OPS_POLICY).get(
  "/replay/run/:runId",
  opsRoute(async ({ c, service }) => {
    const runId = c.req.param("runId") ?? "";
    const run = await service.getReplayRun({ runId });
    if (!run) return c.json({ message: "Replay run not found" }, 404);
    return c.json({ run });
  }),
);

export const app = secured.hono;
