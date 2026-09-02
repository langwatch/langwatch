/**
 * Internal Langy control-plane endpoints — the Go agent's OUTBOUND calls back
 * to the app. Mounted at `/api/internal/langy`, protected by the shared bearer
 * secret `LANGY_INTERNAL_SECRET` (the same secret the control plane presents to
 * the agent on its `/worker/*` turn endpoints). Never expose publicly — the Helm chart
 * blocks `/api/internal` at the ingress by default, and in-cluster callers reach
 * the app through its internal Service rather than the ingress.
 *
 * This is the durable half of the turn lifecycle (see
 * specs/langy/langy-turn-lifecycle.md): the agent posts its final result here
 * over HTTP, independently of the best-effort NDJSON relay, so a completed turn
 * survives the relay dropping mid-stream. Ingest is idempotent on `turnId`.
 *
 * It also hosts `credentials/revoke`, moved here from the public `/api/langy`
 * surface — the Go revoker already dials `/api/internal/langy/credentials/revoke`,
 * so the old registration was a latent path mismatch (a 404 the agent swallowed).
 */

import { internalSecret } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { ValidationError } from "@langwatch/handled-error";
import { type CliToolResult, cliToolResultSchema } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { timingSafeEqual } from "crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import { z } from "zod";

import type { LangyApp } from "#app/langy.app";

const logger = createLogger("langwatch:langy:internal");

/**
 * The counters the durable half publishes.
 *
 * A port because a metric registry is process-wide state a feature package may
 * not own: two registries would give one deployment two answers for the same
 * rate. A process that keeps none passes a no-op and loses the graph, not the
 * behaviour.
 */
export type LangyInternalMetricsPort = Readonly<{
  /** One completed or failed turn, by outcome. */
  turnResult(status: "completed" | "failed"): void;
  /** A revoke that named a key which is not a Langy session key. */
  sessionKeyRevokeRefused(): void;
}>;

/** Everything the internal control plane reaches that Langy does not own. */
export type LangyInternalRestPorts = Readonly<{
  /** The SAME application every other Langy door reads. */
  langy: () => LangyApp;
  /**
   * The shared bearer this surface is gated on, or none.
   *
   * A function rather than a value: the deployment may configure it after the
   * family is built, and an unset secret must answer 503 rather than let the
   * gate fall open.
   */
  internalSecret: () => string | undefined;
  metrics: LangyInternalMetricsPort;
}>;

/**
 * Constant-time bearer check against the shared manager secret, applied as the
 * builder chain for every route (uniform with gateway-internal's verifySecret).
 * A plain `===` leaks the secret one byte at a time to anything that can time
 * our responses, and this surface is reachable from inside the cluster.
 */
export function verifyLangyInternalSecret(
  secretOf: () => string | undefined,
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const secret = secretOf();
    if (!secret) {
      logger.error("LANGY_INTERNAL_SECRET is not configured");
      return c.json({ error: "Not configured" }, 503);
    }
    const header = c.req.header("authorization");
    if (!isAuthorized(header, secret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
    return;
  };
}

function isAuthorized(
  authorizationHeader: string | undefined,
  expected: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expectedBuf = Buffer.from(expected);
  if (presented.length !== expectedBuf.length) return false;
  return timingSafeEqual(presented, expectedBuf);
}

export const langyInternalPolicy = () =>
  internalSecret(
    "langy bearer secret verified by the verifySecret chain (verifyLangyInternalSecret)",
  );

// ── turn result ingest ────────────────────────────────────────────────────

/**
 * A tool call the agent ran, as posted with a completed turn. `output` doubles
 * as the error text when `isError` (a single wire field).
 */
const finalToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  /** Canonical typed result; optional only for older workers during rollout. */
  // Keep the CLI result's own validator as the single source of truth and
  // preserve this route's existing error path at the value boundary.
  result: z
    .custom<CliToolResult>(
      (value) => cliToolResultSchema.safeParse(value).success,
      "Invalid CLI tool result",
    )
    .optional(),
});

const turnResultSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  /** The final assistant prose. Present (possibly empty) on `completed`. */
  text: z.string().optional(),
  toolCalls: z.array(finalToolCallSchema).optional(),
  /**
   * A terminal error code the agent emits on its error frames (e.g.
   * `at-capacity`, `session-not-found`, `worker_spawn_failed`). Mapped to a
   * vetted domain error server-side; never raw prose. Present on `failed`.
   */
  errorCode: z.string().optional(),
});

const revokeCredentialsSchema = z.object({
  apiKeyId: z.string().min(1).max(128),
  // The tenant the key belongs to. Required so the revoke is scoped to one
  // project — without it a bearer-secret holder could revoke any tenant's live
  // session key by id alone.
  projectId: z.string().min(1).max(128),
});

/** Builds the `/api/internal/langy` family over one process's ports. */
export function createLangyInternalRestApp(options: {
  security: AppRestSecurity;
  ports: LangyInternalRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({
    basePath: "/api/internal/langy",
    verifySecret: verifyLangyInternalSecret(ports.internalSecret),
  });

  /**
   * The agent's durable final for a turn. Idempotent on `turnId`: re-posting the
   * same final (the agent's bounded retry, or a final the relay already recorded)
   * collapses to one event at the store. Returns 202 either way — accepted, and
   * the event log is the source of truth for whether it changed anything.
   */
  secured.access(langyInternalPolicy()).post("/turn/:turnId/result", async (c) => {
    const turnId = c.req.param("turnId");
    if (!turnId) {
      throw new ValidationError("turnId is required", {
        meta: { fieldErrors: { turnId: ["turnId is required"] } },
      });
    }

    const parsed = turnResultSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw ValidationError.fromZodError(parsed.error);
    }
    const body = parsed.data;

    // Cross-check the triple before writing. `projectId`/`conversationId` are
    // body fields the bearer alone would otherwise let through unverified — the
    // sibling relay proves the same thing with an HMAC over the runToken, but
    // this durable path has only the shared secret. A turn row exists only if
    // the turn was really accepted under this conversation in this project, so
    // this rejects a forged triple and a benign cross-tenant mix-up alike.
    // 404 (not 4xx-with-detail) so a probe never confirms a cross-tenant id;
    // the manager treats 4xx as terminal, so it will not retry-loop.
    const turnExists = await ports.langy().langyService.turnExists({
      projectId: body.projectId,
      conversationId: body.conversationId,
      turnId,
    });
    if (!turnExists) {
      logger.warn(
        {
          projectId: body.projectId,
          conversationId: body.conversationId,
          turnId,
        },
        "refusing a turn-result ingest for an unknown (project, conversation, turn) triple",
      );
      return c.json({ error: "turn not found" }, 404);
    }

    await ports.langy().langyService.ingestAgentTurnResult({
      projectId: body.projectId,
      conversationId: body.conversationId,
      turnId,
      status: body.status,
      text: body.text,
      toolCalls: body.toolCalls,
      errorCode: body.errorCode,
    });

    // The durable completion of a turn — the one line that says a turn ended
    // and how, attributable by ids and graphable by outcome.
    ports.metrics.turnResult(body.status);
    logger.info(
      {
        projectId: body.projectId,
        conversationId: body.conversationId,
        turnId,
        status: body.status,
        ...(body.errorCode ? { errorCode: body.errorCode } : {}),
      },
      "langy turn result ingested",
    );

    return c.json({ status: "accepted" }, 202);
  });

  // ── credentials/revoke (relocated from /api/langy) ────────────────────────

  /**
   * The agent hands back a session-key handle on worker shutdown so the app can
   * revoke it. The app can only revoke — never mint — keeping the trust boundary
   * where it was. `revokeWorkerSessionKey` refuses any key that is not a Langy
   * session key.
   */
  secured.access(langyInternalPolicy()).post("/credentials/revoke", async (c) => {
    const parsed = revokeCredentialsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw ValidationError.fromZodError(parsed.error);
    }

    const outcome = await ports.langy().langyService.revokeWorkerSessionKey({
      apiKeyId: parsed.data.apiKeyId,
      projectId: parsed.data.projectId,
    });

    switch (outcome) {
      case "revoked":
      case "already_revoked":
        return c.json({ outcome }, 200);
      case "not_found":
        // 404, which the manager treats as success — the key is in the state it
        // asked for. Anything else would make the reaper winning the race look
        // like a fault.
        return c.json({ outcome }, 404);
      case "refused":
        // The id resolved to a key that is not ours. Refused, and loud: this
        // should never happen in normal operation. (The warn with the key id
        // fires inside revokeWorkerSessionKey; the counter makes a sustained
        // rate alertable.)
        ports.metrics.sessionKeyRevokeRefused();
        return c.json({ error: "Not a Langy session key" }, 403);
    }
  });

  return secured.hono;
}
