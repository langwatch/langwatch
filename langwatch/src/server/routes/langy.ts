/**
 * Hono routes for the Langy assistant.
 *
 * Surfaces:
 *   POST   /api/langy/chat                   — streams a chat response by
 *                                              delegating to an OpenCode
 *                                              pod (OPENCODE_AGENT_URL).
 *                                              The pod owns the MCP tool
 *                                              catalog (create/update/run);
 *                                              this route is the auth +
 *                                              persistence + stream-bridge.
 *   GET/PATCH/DELETE /langy/conversations*   — list / rename+share / soft-delete.
 *   DELETE /langy/memory                     — clear all of a user's Langy
 *                                              conversations for a project.
 *   GET    /langy/memory/export              — GDPR export of conversations.
 *
 * Access: LangWatch staff always have Langy. For everyone else it is gated by
 * `release_langy_enabled`, which is the lever for opening Langy beyond staff
 * (see the middleware below). Staff therefore bypass the flag entirely.
 */
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { Context } from "hono";
import { z } from "zod";
import { env } from "~/env.mjs";
import {
  hasProjectPermission,
  type Permission,
  Resources,
} from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { auditLog } from "~/server/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";

import { featureFlagService } from "~/server/featureFlag";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";

import {
  LANGY_GITHUB_PRS_PER_DAY,
  recordExtraLangyGithubPrs,
  releaseLangyGithubPrPermit,
  reserveLangyGithubPrPermit,
} from "~/server/middleware/rate-limit-langy-github-prs";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { connection } from "~/server/redis";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import { createLangyTurnHandoffStore } from "~/server/services/langy/streaming/langyTurnHandoff";
import {
  createLangyTokenBuffer,
  type LangyStreamEntry,
} from "~/server/services/langy/streaming/langyTokenBuffer";
import type { DomainError } from "~/server/app-layer/domain-error";
import {
  LangyConversationNotFoundError,
  LangyConversationNotOwnedError,
} from "~/server/app-layer/langy/errors";
import {
  LangyCredentialResolutionError,
  LangyCredentialService,
} from "~/server/services/langy/LangyCredentialService";
import { extractTextFromParts } from "~/server/app-layer/langy/langy-message.service";
import { stripLangySentinels } from "~/server/services/langy/langySentinels";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import { createLogger } from "~/utils/logger/server";
import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:langy");

/**
 * Response body for a HANDLED domain error. Returns ONLY what the client, the
 * UI, or an AI agent can act on — a safe `error` message, the serialisable
 * `code` (`kind`) to render a tailored experience by, and the renderable
 * `meta`. Internal detail (telemetry, reasons, stack, query internals) stays in
 * server logs, never on the wire (ADR-046).
 */
function handledErrorBody(error: DomainError) {
  return { error: error.message, code: error.kind, meta: error.meta };
}

// The Langy worker carries a service API key with WRITE on every resource
// listed here (see LANGY_PERMISSION_SELECTIONS in services/langy/langyApiKey.ts).
// A user reaching /langy/chat must hold an UPDATE-capable role on EACH of
// these in the project they're chatting against — otherwise Langy becomes a
// privilege-escalation surface where a viewer asks "Langy" to create a
// dataset / trigger / prompt they can't create directly.
//
// `:update` is the minimum because the hierarchy (rbac.ts:hasPermissionWith
// Hierarchy) treats `:manage` as a superset; this lets editors AND admins
// through but locks out view-only custom roles.
//
// Follow-up tracked: PR #4913 ships this admin-only gate as the "smallest
// validating slice"; the correct long-term fix is a caller-scoped API key
// minted per chat session so each tool authorises against the calling user's
// own permissions, not a service key.
const LANGY_REQUIRED_PERMISSIONS: Permission[] = [
  `${Resources.TRACES}:update`,
  `${Resources.EVALUATIONS}:update`,
  `${Resources.DATASETS}:update`,
  `${Resources.SCENARIOS}:update`,
  `${Resources.ANNOTATIONS}:update`,
  `${Resources.ANALYTICS}:update`,
  `${Resources.PROMPTS}:update`,
  `${Resources.TRIGGERS}:update`,
  `${Resources.WORKFLOWS}:update`,
];

// Runtime validation for the untrusted /langy/chat body. Zod-only with infer
// (no parallel TS interface) per the repo's validation convention.
const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
});
const chatRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  messages: z.array(chatMessageSchema).min(1),
  /**
   * Per-send model override coming from the sidebar's ChatGPT-style picker
   * (LangySidebar Composer). Optional — when absent, the agent falls back
   * to the project's DEFAULT-role model the gate resolved against.
   *
   * Forwarded to the OpenCode agent payload so the agent can pass it to the
   * gateway as the `model` parameter. Validated here in two layers: this
   * Zod step enforces provider/model shape; the route then checks the value
   * against the project's Langy VK `modelsAllowed` allowlist so a malicious
   * or stale client can't pick a model the project hasn't approved.
   */
  modelOverride: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/,
      "modelOverride must be in 'provider/model' shape",
    )
    .max(200)
    .optional(),
});
// Persistence is now event-sourced (ADR-046): the user turn is a `SendMessage`
// command and the assistant's final answer is a `ReconcileAgentTurn` command
// (emitting `turn_finalized`). The conversation row and the langy_messages rows
// are both projections of those events, so the old persistMessage + bumpActivity
// dual write is gone — a single command per turn keeps the count/activity and
// the stored message from ever drifting.
//
// Token counts still live on the gateway-emitted OTel trace (see the per-worker
// OPENCODE_OTLP_* env in services/langyagent — the OpenCode OTel plugin exports
// gen_ai.usage.{prompt,completion}_tokens for every LLM call); consumers that
// need usage figures fold the trace by langwatch.thread.id=conversationId, not
// an in-process tokenizer here. Discussed on PR #4913.

// Every Langy route does its own authentication in-handler: the app-level
// guard below validates the session, and each handler additionally checks the
// project-scoped evaluations:view permission. We register through the
// SecuredApp builder with handlerManagedAuth so the routes declare a policy
// (the auth guarantee test requires every concrete endpoint to be classified)
// while keeping that in-handler enforcement.
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
  // Staff bypass the rollout flag so a global kill-switch still leaves us able
  // to debug. Non-staff are gated by `release_langy_enabled`, which defaults
  // off (see featureFlag/registry.ts) — that registry default IS the
  // staff-only behaviour. Without this gate, ordinary project/team members
  // would see and call Langy regardless of the flag, defeating the stated
  // staff-only-by-default policy.
  if (!isLangwatchStaff(session.user)) {
    // User-level targeting only: the langy/* surface is varied (chat takes
    // projectId in body, others take it in query) so the middleware can't
    // cleanly enrich with org context without re-parsing every request. The
    // flag is "is Langy enabled for THIS user" — operator-store rules or
    // PostHog targeting at the user level is the lever.
    const allowed = await featureFlagService.isEnabled(
      "release_langy_enabled",
      { distinctId: session.user.id },
    );
    if (!allowed) {
      return c.json(
        { error: "Langy is not currently enabled for this account." },
        { status: 404 },
      );
    }
  }
  await next();
});

// Thin helper so each route reads `langyRoute().<verb>(path, handler)`.
const langyRoute = () =>
  secured.access(handlerManagedAuth(LANGY_HANDLER_AUTH_REASON));

const AGENT_HEALTH_CHECK_TIMEOUT_MS = 3_000;
const AGENT_CHAT_TIMEOUT_MS = 120_000;

// Preflight before reserving a PR permit or calling /chat: a 3s timeout
// instead of the 120s chat budget, so a fully-down agent fails in seconds
// and never burns a daily PR permit on a dead backend.
//
// Deliberately no retry on the /chat call itself: the agent's worker has
// no idempotency key, and a POST /chat that fails after the agent already
// started acting on the prompt (5xx or a reset mid-stream) would, on
// retry, get replayed as a second independent turn against the same
// worker — risking a duplicate PR. Fixing that properly needs an
// idempotency mechanism on the agent side; until then, a mid-task failure
// surfaces to the user instead of being silently retried.
async function isAgentHealthy(agentUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${agentUrl}/health`, {
      signal: AbortSignal.timeout(AGENT_HEALTH_CHECK_TIMEOUT_MS),
    });
    void response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

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
  } = parsedBody.data;

  const agentUrl = process.env.OPENCODE_AGENT_URL;
  if (!agentUrl) {
    logger.error("OPENCODE_AGENT_URL is not configured");
    return c.json({ error: "Agent not configured" }, { status: 503 });
  }
  const internalSecret = process.env.LANGY_INTERNAL_SECRET;
  if (!internalSecret) {
    logger.error("LANGY_INTERNAL_SECRET is not configured");
    return c.json({ error: "Agent not configured" }, { status: 503 });
  }

  // Coarse gate: the caller must be able to read this project at all. This is
  // defense-in-depth, NOT the fine-grained authorisation. The real
  // least-privilege enforcement is the per-session API key minted in
  // getOrProvision, scoped to exactly the permissions THIS user holds (ADR-047).
  // So we deliberately DON'T require write on every resource here — a user who
  // can edit prompts but not create triggers still gets Langy; their session key
  // simply can't create triggers. A user who holds none of Langy's permissions
  // is refused when the mint yields an empty set (surfaced as a 409 below).
  const canUseLangy = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:view",
  );
  if (!canUseLangy) {
    return c.json(
      { error: "You do not have permission to use Langy for this project." },
      { status: 403 },
    );
  }

  const rl = await checkLangyMessageRateLimit({
    userId: session.user.id,
    projectId,
  });
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

  const conversationService = getApp().langy.conversations;

  // Resolve the conversation id (ownership-checked). No write happens here —
  // the aggregate is created by the first SendMessage command below.
  let conversation;
  try {
    conversation = await conversationService.ensureConversation({
      projectId,
      userId: session.user.id,
      conversationId: requestedConversationId ?? null,
    });
  } catch (error) {
    if (error instanceof LangyConversationNotOwnedError) {
      return c.json(handledErrorBody(error), { status: 403 });
    }
    throw error;
  }

  const lastUserMessage = messages[messages.length - 1];

  try {
    await getVercelAIModel({ projectId });
  } catch (error) {
    // Real error in the server log; surface a generic public message
    // to the user. `error.message` could leak internals (model-provider
    // config-store internals, stack details, env hints). Sergio's
    // 2026-06-30 review round 3.
    logger.warn({ error, projectId }, "getVercelAIModel failed");
    return c.json(
      { error: "No model configured for this project." },
      { status: 409 },
    );
  }

  if (lastUserMessage?.role === "user") {
    // One command: the message_sent event feeds both the conversation fold
    // (owner/title/count/activity) and the langy_messages map projection.
    await conversationService.recordUserMessage({
      projectId,
      conversationId: conversation.id,
      userId: session.user.id,
      parts: lastUserMessage.parts,
      title: extractTextFromParts(messages[0]?.parts).slice(0, 80) || null,
    });
  }

  const userText = extractTextFromParts(lastUserMessage?.parts);

  // The pod's AGENTS.md is written for CLI/codebase instrumentation
  // (the OpenCode default), not in-product Langy. We override with a
  // Langy-specific system block, phrased to fit the MCP tool catalog
  // the pod actually has. Sent as `system` (not concatenated into the
  // user prompt) so the model treats it as instructions, not user
  // content — lower jailbreak risk and cleaner separation.
  const langyOverride = [
    "OVERRIDE — you are Langy, the in-product LangWatch assistant.",
    "You are NOT a code/repo assistant. You do not edit files, run shell, or scaffold projects.",
    "Your only job is to read and act on the user's LangWatch project via the available MCP tools",
    "(search_traces, get_trace, get_analytics, list_evaluators, list_prompts, list_datasets,",
    "list_scenarios, list_agents, list_monitors, list_dashboards, list_workflows, list_triggers,",
    "create_*, update_*, run_*).",
    "Call tools immediately — never describe what you would do, never list your capabilities,",
    "never ask which project, never offer 'next actions'. Pick a reasonable default, act, report",
    "the result tersely with a relevant LangWatch UI URL when applicable.",
  ].join(" ");

  let credentials;
  const credentialService = LangyCredentialService.create(prisma);
  try {
    credentials = await credentialService.getOrProvision({
      projectId,
      session,
    });
  } catch (error) {
    if (error instanceof LangyCredentialResolutionError) {
      return c.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // Defense in depth: when a `modelOverride` rides in, enforce the project's
  // Langy VK allowlist HERE — don't trust the picker UI to gate it. If the VK
  // has no allowlist (modelsAllowed=null), the gateway is still the final
  // enforcer; this check only rejects values the project has explicitly NOT
  // allowed. The org is taken from `credentials` (the resolver already
  // returned it) so we don't refetch the project — no risk of a TOCTOU race
  // silently skipping the check between calls.
  //
  // Order matters: this runs BEFORE the PR-permit reservation so an invalid
  // modelOverride doesn't burn a daily PR slot. The earlier ordering leaked
  // a permit on every 400 here.
  if (modelOverride) {
    const modelsAllowed = await credentialService.getModelsAllowed({
      projectId,
      organizationId: credentials.organizationId,
    });
    if (modelsAllowed && !modelsAllowed.includes(modelOverride)) {
      // Don't log the full allowlist on every reject — it's the project's
      // configured-model list and travels further than the user's UI does
      // (SIEM, support tickets). Log shape + count so we still see drift.
      logger.warn(
        { projectId, modelOverride, allowedCount: modelsAllowed.length },
        "modelOverride not in VK allowlist — rejecting",
      );
      return c.json(
        {
          error: `Model "${modelOverride}" is not allowed for this project's Langy. Pick from the configured models.`,
        },
        { status: 400 },
      );
    }
  }

  // No more synchronous `isAgentHealthy` preflight: the turn is dispatched
  // asynchronously and the liveness reconcile sweep (ADR-044) recovers a turn
  // whose worker never comes up, so a preflight round-trip buys nothing.

  // Per-user daily PR cap, enforced by atomic permit reservation BEFORE we
  // hand the worker a GitHub token. If we're over cap, we strip the token from
  // `credentials` below so the worker physically cannot `gh pr create` (no
  // GH_TOKEN env in the subprocess) — the system note is a courtesy
  // explanation, not the authorisation boundary.
  //
  // Permit lifecycle now spans the async turn (ADR-044): the RESERVE stays here
  // (gate-keeping GH_TOKEN before the worker spawns), but the RECONCILE/RELEASE
  // moves to the worker's runTurn, which sees the PRs the turn actually opened.
  // The route only releases on an early exit that never starts a turn (the
  // busy-guard below). Release still gates on `permit.reserved`, NOT
  // `permit.allowed`: a Redis-down reserve returns `reserved: false`, and
  // DECRing that path walks the shared daily counter negative (the
  // erosion-via-blip cap-bypass Sergio caught on 2026-06-30).
  const permit = await reserveLangyGithubPrPermit({ userId: session.user.id });
  const releaseReservedPermit = async () => {
    if (!permit.reserved) return;
    try {
      await releaseLangyGithubPrPermit({ userId: session.user.id });
    } catch (error) {
      logger.warn({ error }, "failed to release langy github PR permit");
    }
  };
  const capReachedNote = !permit.allowed
    ? [
        "",
        "USER PR CAP REACHED — the user has already opened the per-day maximum",
        "of",
        String(LANGY_GITHUB_PRS_PER_DAY),
        "GitHub pull requests via Langy today.",
        "If the user asks you to open a PR, refuse politely, say the daily cap",
        "is reached, and that it resets at",
        new Date(permit.resetAt).toISOString(),
        "UTC.",
        "Do not call any tool that opens a PR.",
      ].join(" ")
    : "";
  // Revoke GitHub capability when the cap is reached: deleting these fields
  // means the agent omits GH_TOKEN + GITHUB_LOGIN from the worker subprocess
  // env (services/langyagent/worker.go::spawnOpenCode conditionally appends
  // them based on truthiness), so the worker cannot reach github.com with
  // an authenticated token even if it ignores the system note.
  if (!permit.allowed) {
    delete (credentials as { githubToken?: string }).githubToken;
    delete (credentials as { githubLogin?: string }).githubLogin;
  }

  // Busy-guard: one turn in flight per conversation. Replaces the manager's
  // Worker.tryClaim 409 — a turn in flight means the fold status is "running".
  const current = await conversationService.getById({
    id: conversation.id,
    projectId,
    userId: session.user.id,
  });
  if (current?.status === LANGY_CONVERSATION_STATUS.RUNNING) {
    await releaseReservedPermit();
    return c.json(
      { error: "A response is already in progress for this conversation." },
      { status: 409 },
    );
  }

  if (!connection) {
    await releaseReservedPermit();
    logger.error("No Redis connection — cannot start langy turn");
    return c.json(
      { error: "Agent is temporarily unavailable. Please try again shortly." },
      { status: 503 },
    );
  }

  // Generate the turnId up front so the out-of-band spawn handoff is stashed
  // BEFORE `agent_turn_started` is dispatched — otherwise the spawn reactor
  // could fire and find no handoff. The handoff carries the session-scoped
  // credentials + prompt + system; the durable event carries only ids (ADR-044).
  const turnId = crypto.randomUUID();
  const system = capReachedNote
    ? `${langyOverride}\n\n${capReachedNote}`
    : langyOverride;

  const handoffStore = createLangyTurnHandoffStore({ redis: connection });
  await handoffStore.stash({
    projectId,
    conversationId: conversation.id,
    turnId,
    actorUserId: session.user.id,
    prompt: userText,
    system,
    ...(modelOverride ? { modelOverride } : {}),
    credentials,
    permitReserved: permit.reserved,
  });

  try {
    await conversationService.startTurn({
      projectId,
      conversationId: conversation.id,
      turnId,
    });
  } catch (error) {
    await releaseReservedPermit();
    logger.error({ error }, "failed to dispatch langy StartAgentTurn");
    return c.json({ error: "Agent request failed" }, { status: 502 });
  }

  // Attach to the turn's live token stream (tail + follow). Same read path a
  // refreshed client uses — the browser is unchanged (same UI-message envelope,
  // same x-langy-conversation-id header). The permit reconcile/audit now happen
  // on the worker (runTurn), not here.
  const stream = attachTurnStream({
    conversationId: conversation.id,
    turnId,
  });
  const streamResponse = createUIMessageStreamResponse({ stream });
  const headers = new Headers(streamResponse.headers);
  headers.set("x-langy-conversation-id", conversation.id);
  headers.set("x-langy-turn-id", turnId);
  return new Response(streamResponse.body, {
    status: streamResponse.status,
    headers,
  });
});

/**
 * Bridge a turn's Redis token stream to a UI-message stream (ADR-044 part 3).
 * Reads the buffered tail (`XRANGE`) then follows the live edge (`XREAD BLOCK`)
 * from the last-seen id — one primitive, so a chunk emitted between replay and
 * attach is never lost. Raw `delta` entries (which still carry the `[langy:*]`
 * sentinels the existing client parses) become text-deltas; the separated
 * status/progress/milestone entries are additive and ignored by today's client.
 */
function attachTurnStream({
  conversationId,
  turnId,
}: {
  conversationId: string;
  turnId: string;
}) {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      const textId = crypto.randomUUID();
      writer.write({ type: "text-start", id: textId });

      const emit = (entry: LangyStreamEntry) => {
        if (entry.type === "delta") {
          writer.write({ type: "text-delta", delta: entry.text, id: textId });
        }
      };

      if (!connection) {
        writer.write({ type: "text-end", id: textId });
        return;
      }

      // A dedicated connection for the blocking follow read so it never wedges
      // the shared client; closed in the finally below.
      const blocking = connection.duplicate();
      const buffer = createLangyTokenBuffer({
        redis: connection,
        blockingRedis: blocking,
      });
      // Bound the attach to the turn timeout so a wedged worker can't hold the
      // response open forever; the reconcile sweep terminalizes the turn.
      const abort = AbortSignal.timeout(AGENT_CHAT_TIMEOUT_MS);
      try {
        const { reads, lastId } = await buffer.readTail({
          conversationId,
          turnId,
        });
        let terminal = false;
        for (const { entry } of reads) {
          emit(entry);
          if (entry.type === "end" || entry.type === "error") terminal = true;
        }
        if (!terminal) {
          for await (const { entry } of buffer.follow({
            conversationId,
            turnId,
            fromId: lastId,
            signal: abort,
          })) {
            emit(entry);
            if (entry.type === "end" || entry.type === "error") break;
          }
        }
      } finally {
        writer.write({ type: "text-end", id: textId });
        blocking.disconnect();
      }
    },
    onError: (error) => {
      logger.error({ error }, "error attaching to langy turn stream");
      return "An error occurred while processing your request.";
    },
  });
}

/**
 * Refresh-resume: reattach to a turn without POSTing a new message (ADR-044).
 * A refreshed client reconnects here with the turnId it was streaming. Finished
 * turns are served from durable state (the assistant message), so no worker is
 * spawned to reproduce an answer.
 */
langyRoute().get("/langy/conversations/:id/stream", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const turnId = c.req.query("turnId");
  if (!turnId) {
    return c.json({ error: "Missing turnId" }, { status: 400 });
  }
  const convService = getApp().langy.conversations;
  const conv = await convService.getById({
    id,
    projectId: projectId!,
    userId: guard.session!.user.id,
  });
  if (!conv) {
    return c.json(handledErrorBody(new LangyConversationNotFoundError(id)), {
      status: 404,
    });
  }

  const stream = attachTurnStream({ conversationId: id, turnId });
  const streamResponse = createUIMessageStreamResponse({ stream });
  const headers = new Headers(streamResponse.headers);
  headers.set("x-langy-conversation-id", id);
  headers.set("x-langy-turn-id", turnId);
  return new Response(streamResponse.body, {
    status: streamResponse.status,
    headers,
  });
});

// ============================================================================
// Conversation management
// ============================================================================

async function requireSessionAndPermission(
  c: Context,
  projectId: string | undefined,
) {
  const session = await getServerAuthSession({
    req: c.req.raw as NextRequestShim,
  });
  if (!session)
    return { error: c.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!projectId)
    return { error: c.json({ error: "Missing projectId" }, { status: 400 }) };
  // Reject the demo project explicitly: `hasProjectPermission(..., "evaluations:view")`
  // grants every authenticated user view on the demo via `isDemoProject`'s
  // globally-readable allowlist (see rbac.ts:DEMO_VIEW_PERMISSIONS). For Langy
  // conversation/memory routes that's a leak — a user past the rollout flag
  // could `GET/PATCH/DELETE /langy/conversations*` and `/langy/memory*` on
  // the demo project, accessing or destroying chat content that belongs to
  // whichever user actually used Langy there. The demo project IS public,
  // but per-user chat conversations on it should not be. Recurring #3323
  // trap — feature surfaces that look read-only-public still need to gate
  // user-owned data inside them.
  const demoId = process.env.DEMO_PROJECT_ID ?? env.DEMO_PROJECT_ID;
  if (demoId && projectId === demoId) {
    return {
      error: c.json(
        { error: "Langy is not available on the demo project." },
        { status: 403 },
      ),
    };
  }
  const ok = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:view",
  );
  if (!ok) return { error: c.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

langyRoute().get("/langy/conversations", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const limit = Number(c.req.query("limit") ?? "50");
  const service = getApp().langy.conversations;
  const conversations = await service.getAll({
    projectId: projectId!,
    userId: guard.session!.user.id,
    limit: Math.min(Math.max(limit, 1), 100),
  });
  return c.json({ conversations });
});

langyRoute().get("/langy/conversations/:id", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const convService = getApp().langy.conversations;
  const conv = await convService.getById({
    id,
    projectId: projectId!,
    userId: guard.session!.user.id,
  });
  if (!conv)
    return c.json(handledErrorBody(new LangyConversationNotFoundError(id)), {
      status: 404,
    });
  const msgService = getApp().langy.messages;
  const messages = await msgService.getRecordsByConversation({
    conversationId: conv.id,
    projectId: projectId!,
  });
  return c.json({ conversation: conv, messages });
});

const patchConversationSchema = z.object({
  projectId: z.string().min(1),
  // `null` clears the title; `undefined` (omitted) leaves it alone. We don't
  // accept arbitrary types here — `as` casting would let `isShared: "yes"`
  // (truthy string) trip the share/audit branch and let a non-string `title`
  // reach the service layer where the column type would silently coerce.
  title: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
});

langyRoute().patch("/langy/conversations/:id", async (c) => {
  const parsed = patchConversationSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const guard = await requireSessionAndPermission(c, body.projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const service = getApp().langy.conversations;
  try {
    const updated = await service.updateById({
      id,
      projectId: body.projectId,
      userId: guard.session!.user.id,
      title: body.title,
      isShared: body.isShared,
    });
    if (body.isShared !== undefined) {
      await auditLog({
        userId: guard.session!.user.id,
        projectId: body.projectId,
        action: body.isShared
          ? "langy.conversation.share"
          : "langy.conversation.unshare",
        args: { conversationId: id },
      });
    }
    return c.json({ conversation: updated });
  } catch (error) {
    if (LangyConversationNotFoundError.is(error)) {
      return c.json(handledErrorBody(error), { status: 404 });
    }
    logger.error({ error }, "failed to update langy conversation");
    return c.json(
      { error: "An unexpected error occurred.", code: "unknown" },
      { status: 500 },
    );
  }
});

langyRoute().delete("/langy/conversations/:id", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const service = getApp().langy.conversations;
  const ok = await service.deleteById({
    id,
    projectId: projectId!,
    userId: guard.session!.user.id,
  });
  if (!ok)
    return c.json(handledErrorBody(new LangyConversationNotFoundError(id)), {
      status: 404,
    });
  return c.json({ success: true });
});

// ============================================================================
// Memory clear-all + GDPR export
// ============================================================================

langyRoute().delete("/langy/memory", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const userId = guard.session!.user.id;
  const convService = getApp().langy.conversations;
  const result = await convService.clearAllForUser({
    projectId: projectId!,
    userId,
  });
  await auditLog({
    userId,
    projectId: projectId!,
    action: "langy.memory.clear_all",
    args: { deletedCount: result.deletedCount },
  });
  return c.json({ deletedCount: result.deletedCount });
});

langyRoute().get("/langy/memory/export", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const userId = guard.session!.user.id;
  const convService = getApp().langy.conversations;
  const conversations = await convService.getAll({
    projectId: projectId!,
    userId,
    limit: 1000,
  });
  const msgService = getApp().langy.messages;
  const conversationsWithMessages = await Promise.all(
    conversations
      .filter((c) => c.isOwn)
      .map(async (c) => ({
        conversation: c,
        messages: await msgService.getAllByConversation({
          conversationId: c.id,
          projectId: projectId!,
        }),
      })),
  );
  await auditLog({
    userId,
    projectId: projectId!,
    action: "langy.memory.export",
    args: { conversationCount: conversationsWithMessages.length },
  });
  return c.json({
    exportedAt: new Date().toISOString(),
    projectId,
    userId,
    conversations: conversationsWithMessages,
  });
});

export const app = secured.hono;
