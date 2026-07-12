/**
 * Hono routes for the Langy assistant.
 *
 * Only surface left: `POST /api/langy/chat` — the turn-START endpoint. It now
 * does ONLY Phase 1 (session auth, demo gate, project-permission gate, rate
 * limit, body validation) and then delegates the whole turn-start orchestration
 * to `getApp().langy.turns` (LangyTurnService), mapping the DomainErrors it
 * throws to HTTP. It no longer streams: the browser subscribes to the
 * `langy.onTurnStream` tRPC subscription for the live turn, and
 * reads/lists/deletes go through the `api.langy.*` tRPC router.
 *
 * Access: LangWatch staff always have Langy. For everyone else it is gated by
 * `release_langy_enabled` (see the middleware below). Staff bypass the flag.
 */
import { z } from "zod";
import { hasProjectPermission, isDemoProjectId } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";
import { getLangWatchTracer } from "langwatch";
import { DomainError } from "~/server/app-layer/domain-error";
import { langyTurnContextSchema } from "~/server/services/langy/langyTurnContext.schema";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import { createLogger } from "~/utils/logger/server";
import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:langy");

// Every phase of a turn's critical path hangs off this tracer; the waterfall
// replaces guesswork about where a turn's seconds go.
const tracer = getLangWatchTracer("langwatch.langy.chat");

/**
 * Response body for a HANDLED domain error. Returns ONLY what the client/UI/agent
 * can act on — a safe `error`, the serialisable `code` (`kind`), and renderable
 * `meta`. Internal detail stays in server logs (ADR-046).
 */
function handledErrorBody(error: DomainError) {
  return { error: error.message, code: error.kind, meta: error.meta };
}

// Runtime validation for the untrusted /langy/chat body. Zod-only with infer.
const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
});
const chatRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  messages: z.array(chatMessageSchema).min(1),
  /**
   * Per-send model override from the sidebar picker. Validated in two layers:
   * this Zod step enforces provider/model shape; the turn service checks the
   * value against the project's Langy VK allowlist.
   */
  modelOverride: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/,
      "modelOverride must be in 'provider/model' shape",
    )
    .max(200)
    .optional(),
  /**
   * Why the client is POSTing. `regenerate-message` RE-DRIVES the last turn
   * against the message already on record (so we do NOT re-post it).
   */
  trigger: z
    .enum(["submit-message", "regenerate-message", "resume-stream"])
    .optional(),
  // Composer context chips (page context + skills) — bounded + sanitised in
  // renderLangyTurnContext; refs are never resolved by the control plane.
  ...langyTurnContextSchema.shape,
});

// Every Langy route authenticates in-handler: the app-level guard validates the
// session; each handler additionally checks project-scoped evaluations:view.
const LANGY_HANDLER_AUTH_REASON =
  "Session-gated UI route enforced by the app-level guard; " +
  "project evaluations:view checked per-handler.";

const secured = createServiceApp({ basePath: "/api" });

secured.hono.use("/langy/*", async (c, next) => {
  const session = await getServerAuthSession({
    req: c.req.raw as NextRequestShim,
  });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }
  // Staff bypass the rollout flag so a global kill-switch still leaves us able to
  // debug. Non-staff are gated by `release_langy_enabled` (default off).
  if (!isLangwatchStaff(session.user)) {
    const allowed = await featureFlagService.isEnabled("release_langy_enabled", {
      distinctId: session.user.id,
    });
    if (!allowed) {
      return c.json(
        { error: "Langy is not currently enabled for this account." },
        { status: 404 },
      );
    }
  }
  await next();
});

const langyRoute = () =>
  secured.access(handlerManagedAuth(LANGY_HANDLER_AUTH_REASON));

langyRoute().post("/langy/chat", async (c) => {
  const session = await getServerAuthSession({
    req: c.req.raw as NextRequestShim,
  });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const parsedBody = chatRequestSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return c.json({ error: "Invalid request body" }, { status: 400 });
  }
  const {
    messages,
    projectId,
    conversationId: requestedConversationId,
    modelOverride,
    trigger,
    pageContext,
    skills,
  } = parsedBody.data;

  // Langy is not available on the public demo project (evaluations:view is
  // granted to everyone there).
  if (isDemoProjectId(projectId)) {
    return c.json(
      { error: "Langy is not available on the demo project." },
      { status: 403 },
    );
  }
  // A regenerate RE-DRIVES the failed turn against the message already on record.
  const isRetry = trigger === "regenerate-message";

  // ── PHASE 1: THE GATE ──────────────────────────────────────────────────────
  // Coarse "can read this project at all" + rate limit. Both are independent
  // round trips and wait together; their PRECEDENCE is load-bearing — a
  // forbidden caller gets 403, not whatever the limiter said. They run BEFORE
  // reaching the app layer, so a forbidden/limited caller never mints keys or
  // reads conversations.
  const [permission, rateLimit] = await tracer.withActiveSpan(
    "langy.chat.phase1_gate",
    { attributes: { "tenant.id": projectId, "langy.phase": "gate" } },
    async () =>
      Promise.allSettled([
        hasProjectPermission({ prisma, session }, projectId, "evaluations:view"),
        checkLangyMessageRateLimit({ userId: session.user.id, projectId }),
      ]),
  );

  if (permission.status === "rejected") throw permission.reason;
  if (!permission.value) {
    return c.json(
      { error: "You do not have permission to use Langy for this project." },
      { status: 403 },
    );
  }

  if (rateLimit.status === "rejected") throw rateLimit.reason;
  const rl = rateLimit.value;
  if (!rl.allowed) {
    return c.json(
      {
        error: "Too many messages. Please slow down.",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      {
        status: 429,
        headers: rl.retryAfterSeconds
          ? { "Retry-After": String(rl.retryAfterSeconds) }
          : undefined,
      },
    );
  }

  // ── DELEGATE: the whole turn-start orchestration lives in LangyTurnService ──
  // It throws DomainErrors (each carrying its httpStatus); everything else is
  // infrastructure and surfaces generically. The browser reads {conversationId,
  // turnId} and then subscribes to langy.onTurnStream.
  try {
    const result = await getApp().langy.turns.startConversationTurn({
      projectId,
      session,
      requestedConversationId: requestedConversationId ?? null,
      messages,
      ...(modelOverride ? { modelOverride } : {}),
      isRetry,
      turnContext: { pageContext, skills },
    });
    return c.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return c.json(handledErrorBody(error), {
        status: error.httpStatus as 400 | 403 | 409 | 503,
      });
    }
    logger.error({ error, projectId }, "langy turn-start failed");
    return c.json({ error: "Agent request failed" }, { status: 502 });
  }
});

export const app = secured.hono;
