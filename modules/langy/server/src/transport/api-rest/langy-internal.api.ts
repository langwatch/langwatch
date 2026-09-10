/**
 * Internal Langy control-plane endpoints — the Go agent's OUTBOUND calls back to the app.
 */

import { internalSecret, isInternalSecretValid } from "@langwatch/api";
import {
  type AppRestSecurity,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { ValidationError } from "@langwatch/handled-error";
import {
  langyRevokeCredentialsSchema,
  langyTurnResultSchema,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { Context, MiddlewareHandler, Next } from "hono";
import { z } from "zod";

import type { LangyApp } from "#app/langy.app";

const logger = createLogger("langwatch:langy:internal");

/**
 * The counters the durable half publishes. A port because a metric registry is process-wide
 * state a feature package may not own: two registries would give one deployment two answers for
 * the same rate.
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
   * The shared bearer this surface is gated on, or none. A function rather than a value: the
   * deployment may configure it after the family is built, and an unset secret must answer 503
   * rather than let the gate fall open.
   */
  internalSecret: () => string | undefined;
  metrics: LangyInternalMetricsPort;
}>;

/**
 * Constant-time bearer check against the shared manager secret, applied as the builder chain
 * for every route (uniform with gateway-internal's verifySecret).
 */
export function verifyLangyInternalSecret(secretOf: () => string | undefined): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const secret = secretOf();
    if (!secret) {
      logger.error("LANGY_INTERNAL_SECRET is not configured");
      return c.json({ error: "Not configured" }, 503);
    }
    const header = c.req.header("authorization");
    if (!isInternalSecretValid({ authorizationHeader: header, expected: secret })) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
    return;
  };
}

export const langyInternalPolicy = () =>
  internalSecret(
    "langy bearer secret verified by the verifySecret chain (verifyLangyInternalSecret)",
  );

// ── turn result ingest ────────────────────────────────────────────────────

/** Builds the `/api/internal/langy` family over one process's ports. */
export function createLangyInternalRestApp(options: {
  security: AppRestSecurity;
  ports: LangyInternalRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createServiceVersionedApp({
    name: "langy-internal",
    basePath: "/api/internal/langy",
    // The Go agent calls these exact paths; a control plane between two halves
    // of one deployment has no dated contract to negotiate.
    staticGeneration: "v1",
    errorEnvelope: "legacy",
    verifySecret: verifyLangyInternalSecret(ports.internalSecret),
  });

  const internal = policy(langyInternalPolicy());

  /**
   * The agent's durable final for a turn. Idempotent on `turnId`: re-posting the same final
   * (the agent's bounded retry, or a final the relay already recorded) collapses to one event
   * at the store.
   */
  const turnResultHandler = async (c: Context) => {
    const turnId = c.req.param("turnId");
    if (!turnId) {
      throw new ValidationError("turnId is required", {
        meta: { fieldErrors: { turnId: ["turnId is required"] } },
      });
    }

    const parsed = langyTurnResultSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw ValidationError.fromZodError(parsed.error);
    }
    const body = parsed.data;

    // Cross-check the triple before writing. `projectId`/`conversationId` are body fields the
    // bearer alone would otherwise let through unverified — the sibling relay proves the same
    // thing with an HMAC over the runToken, but this durable path has only the shared secret. A
    // turn row exists only if the turn was really accepted under this conversation in this
    // project, so this rejects a forged triple and a benign cross-tenant mix-up alike.
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
  };

  // ── credentials/revoke (relocated from /api/langy) ────────────────────────

  /**
   * The agent hands back a session-key handle on worker shutdown so the app can revoke it. The
   * app can only revoke — never mint — keeping the trust boundary where it was.
   * `revokeWorkerSessionKey` refuses any key that is not a Langy session key.
   */
  const revokeHandler = async (c: Context) => {
    const parsed = langyRevokeCredentialsSchema.safeParse(await c.req.json().catch(() => null));
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
  };

  return service
    .registerRoute("post", "/turn/:turnId/result", MANAGEMENT_API_VERSION, turnResultHandler, (b) =>
      internal(b)
        .withParams(z.object({ turnId: z.string().min(1) }))
        .withRawResponse(
          "the agent reads the ingest's own statuses: 202 accepted, 404 for an " +
            "unknown (project, conversation, turn) triple",
        ),
    )
    .registerRoute("post", "/credentials/revoke", MANAGEMENT_API_VERSION, revokeHandler, (b) =>
      internal(b).withRawResponse(
        "the manager reads the revoke outcome and its status: 200 revoked or already " +
          "revoked, 404 not found (treated as success), 403 for a key that is not ours",
      ),
    )
    .build();
}
