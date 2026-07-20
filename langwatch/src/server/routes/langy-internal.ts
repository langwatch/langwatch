/**
 * Internal Langy control-plane endpoints — the Go agent's OUTBOUND calls back
 * to the app. Mounted at `/api/internal/langy`, protected by the shared bearer
 * secret `LANGY_INTERNAL_SECRET` (the same secret the control plane presents to
 * the agent on its `/worker/*` turn endpoints). Never expose publicly — the
 * Helm chart enforces this by default, hard-blocking `/api/internal` at the
 * ingress (`ingress.blockedPaths` in `charts/langwatch/values.yaml`); in-cluster
 * callers reach the app via the internal Service, not the ingress.
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

import type { Context, Next } from "hono";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  cliToolResultSchema,
  type CliToolResult,
} from "@langwatch/cli-cards";

import { createServiceApp, internalSecret } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { ValidationError } from "@langwatch/handled-error";
import { prisma } from "~/server/db";
import { revokeLangySessionApiKey } from "~/server/app-layer/langy/langyApiKey";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:langy-internal");

/**
 * Constant-time bearer check against the shared manager secret, applied as the
 * builder chain for every route (uniform with gateway-internal's verifySecret).
 * A plain `===` leaks the secret one byte at a time to anything that can time
 * our responses, and this surface is reachable from inside the cluster.
 */
export async function verifyLangyInternalSecret(c: Context, next: Next) {
  const secret = process.env.LANGY_INTERNAL_SECRET;
  if (!secret) {
    logger.error("LANGY_INTERNAL_SECRET is not configured");
    return c.json({ error: "Not configured" }, 503);
  }
  const header = c.req.header("authorization");
  if (!isAuthorized(header, secret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
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

const secured = createServiceApp({
  basePath: "/api/internal/langy",
  verifySecret: verifyLangyInternalSecret,
});

const langyInternalPolicy = () =>
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
  // cliToolResultSchema is intentionally built on the zod/v4 compatibility
  // runtime shared by the CLI and app. Keep that runtime out of this zod/v3
  // object graph and bridge it at the value boundary instead.
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

  const parsed = turnResultSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    throw ValidationError.fromZodError(parsed.error);
  }
  const body = parsed.data;

  await getApp().langy.conversations.ingestAgentTurnResult({
    projectId: body.projectId,
    conversationId: body.conversationId,
    turnId,
    status: body.status,
    text: body.text,
    toolCalls: body.toolCalls,
    errorCode: body.errorCode,
  });

  return c.json({ status: "accepted" }, 202);
});

// ── credentials/revoke (relocated from /api/langy) ────────────────────────

const revokeCredentialsSchema = z.object({
  apiKeyId: z.string().min(1).max(128),
});

/**
 * The agent hands back a session-key handle on worker shutdown so the app can
 * revoke it. The app can only revoke — never mint — keeping the trust boundary
 * where it was. `revokeLangySessionApiKey` refuses any key that is not a Langy
 * session key.
 */
secured.access(langyInternalPolicy()).post("/credentials/revoke", async (c) => {
  const parsed = revokeCredentialsSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    throw ValidationError.fromZodError(parsed.error);
  }

  const outcome = await revokeLangySessionApiKey({
    prisma,
    apiKeyId: parsed.data.apiKeyId,
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
      // should never happen in normal operation.
      return c.json({ error: "Not a Langy session key" }, 403);
  }
});

export const app = secured.hono;
