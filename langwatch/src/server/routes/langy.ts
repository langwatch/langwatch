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
import { timingSafeEqual } from "crypto";
import {
  LangySessionKeyScopeError,
  mintLangySessionApiKey,
  revokeLangySessionApiKey,
} from "~/server/services/langy/langyApiKey";
import { env } from "~/env.mjs";
import { hasProjectPermission, isDemoProjectId } from "~/server/api/rbac";
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
import { getLangWatchTracer } from "langwatch";
import { context, propagation } from "@opentelemetry/api";
import { connection } from "~/server/redis";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import { createLangyTurnHandoffStore } from "~/server/services/langy/streaming/langyTurnHandoff";
import { createLangyTurnAccessStore } from "~/server/services/langy/streaming/langyTurnAccess";
import {
  createLangyTokenBuffer,
  type LangyStreamEntry,
} from "~/server/services/langy/streaming/langyTokenBuffer";
import { subscribeFastTokens } from "~/server/services/langy/streaming/langyFastStream";
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
import {
  langyTurnContextSchema,
  renderLangyTurnContext,
} from "~/server/services/langy/langyTurnContext.schema";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import { createLogger } from "~/utils/logger/server";
import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:langy");

// Every phase of a turn's critical path hangs off this tracer. Before it existed
// the Langy path emitted NO spans at all, so a slow turn could only be explained
// by inference — the whole point of these spans is that the waterfall replaces
// the guesswork about where a turn's seconds actually go.
const tracer = getLangWatchTracer("langwatch.langy.chat");

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
  /**
   * Why the client is POSTing (the AI-SDK `DefaultChatTransport` already puts
   * this on every request body; we simply stopped throwing it away).
   *
   *   `submit-message`     — a NEW user message. Persist it, then run the turn.
   *   `regenerate-message` — RE-DRIVE the last turn. The user's message is
   *                          ALREADY on record from the send that failed, so
   *                          recording it again would append a second copy of
   *                          the same question to the conversation (the fold's
   *                          MessageCount and the langy_messages projection both
   *                          count it twice — `recordUserMessage` mints a fresh
   *                          message id and has no idempotency key).
   *
   * This is what makes a retry — manual OR automatic, see
   * `features/langy/logic/langyRecoveryPolicy.ts` — safe: it re-runs the TURN,
   * it does not re-post the MESSAGE.
   */
  trigger: z
    .enum(["submit-message", "regenerate-message", "resume-stream"])
    .optional(),
  /**
   * What the user is LOOKING AT — the composer's context chips (the trace they
   * have open, the rows they ticked, the search they narrowed to).
   *
   * This was sent by the client from day one and read by NOBODY: the schema did
   * not declare it, and a non-strict Zod object silently strips what it does not
   * know, so every chip was thrown away at the door. The chips were decorative.
   *
   * Untrusted input on its way to a model — bounded here (count + string
   * lengths), sanitised and framed as DATA in `renderLangyPageContext`, and its
   * `ref`s are never resolved by the control plane. See that module's header for
   * the prompt-injection and authorisation reasoning.
   */
  ...langyTurnContextSchema.shape,
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
/** The warm is fire-and-forget; don't let it hold a socket open. */
const AGENT_WARM_TIMEOUT_MS = 3_000;
/**
 * The probe sits in front of EVERY message, so it gets a tight budget. It exists
 * to save a ~70ms mint; spending longer than that waiting for the answer would
 * make it a pessimisation. On timeout we fail open and mint, exactly as before.
 */
const AGENT_PROBE_TIMEOUT_MS = 1_000;

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

/**
 * Boot the conversation's worker ahead of the turn (manager `POST /warm`).
 *
 * The control plane knows a turn is coming the instant the browser POSTs — long
 * before the event-sourced dispatch reaches the manager. Warming here takes the
 * opencode spawn off the critical path: it happens in parallel with the rest of
 * this request instead of in front of the first token.
 *
 * Never awaited, never throws. The turn behind it is unaffected by a warm that
 * fails, and cannot be duplicated by one that succeeds: `/warm` acquires a worker
 * but never claims it or posts a message, so it cannot start a turn. The later
 * `/chat` reuses the same worker because `Pool.Acquire` is keyed by conversation
 * id and the credential signature matches (the caller warms only once the
 * credentials are final).
 */
/**
 * Asks the manager whether a worker with these capabilities is already running,
 * so we can skip minting a session key it would only discard.
 *
 * FAILS OPEN, and that direction matters. If the manager is unreachable, slow, or
 * answers nonsense, we return false and the caller mints — which is exactly the
 * behaviour that existed before this optimisation. The worst outcome of a broken
 * probe is the old cost, never a broken turn. Returning `true` on failure would
 * send a keyless turn at a manager that may need to spawn, converting a probe
 * outage into a user-visible retry storm.
 *
 * Short timeout for the same reason: this sits in front of every message, and a
 * hung manager must cost us a spawn's worth of minting, not the whole turn.
 */
async function probeLangyWorker({
  agentUrl,
  internalSecret,
  conversationId,
  model,
  hasGithubAuth,
  egressAllowlist,
}: {
  agentUrl: string;
  internalSecret: string;
  conversationId: string;
  model?: string;
  hasGithubAuth: boolean;
  egressAllowlist?: string[];
}): Promise<boolean> {
  try {
    const response = await fetch(`${agentUrl}/worker/probe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalSecret}`,
      },
      body: JSON.stringify({
        conversationId,
        // The capability fields, not a pre-computed signature: the manager owns
        // the canonicalisation (egress sorting/normalising) and computing it here
        // too would be a second copy of the rule, free to drift until every probe
        // silently missed and we were back to minting every turn.
        ...(model ? { model } : {}),
        hasGithubAuth,
        ...(egressAllowlist?.length ? { egressAllowlist } : {}),
      }),
      signal: AbortSignal.timeout(AGENT_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { alive?: unknown };
    return body.alive === true;
  } catch (error) {
    logger.debug(
      { error, conversationId },
      "langy worker probe failed — minting a session key as if cold",
    );
    return false;
  }
}

async function warmLangyWorker({
  agentUrl,
  internalSecret,
  conversationId,
  credentials,
  modelOverride,
}: {
  agentUrl: string;
  internalSecret: string;
  conversationId: string;
  credentials: unknown;
  modelOverride?: string;
}): Promise<void> {
  // Its own span, and the one worth staring at: the warm is fire-and-forget, so
  // the ONLY way to know whether the worker boot actually hides behind the rest
  // of the turn is to see this span overlap the ones that follow it in the
  // waterfall. If it instead sits to the right of them, the warm is buying
  // nothing and the boot is still on the critical path.
  //
  // `traceparent` is injected so the Go manager's spawn/boot spans attach to THIS
  // trace as children rather than surfacing as a disconnected trace with no
  // explanation of who asked for them.
  await tracer.withActiveSpan(
    "langy.chat.warm_worker",
    { attributes: { "langy.conversation.id": conversationId } },
    async () => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalSecret}`,
        };
        propagation.inject(context.active(), headers);

        const response = await fetch(`${agentUrl}/warm`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            conversationId,
            credentials,
            ...(modelOverride ? { modelOverride } : {}),
          }),
          signal: AbortSignal.timeout(AGENT_WARM_TIMEOUT_MS),
        });
        void response.body?.cancel();
      } catch (error) {
        // A cold start is the status quo, not a failure. Debug-level on purpose.
        logger.debug(
          { error, conversationId },
          "langy worker warm failed — cold-starting",
        );
      }
    },
  );
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
    trigger,
    pageContext,
    skills,
  } = parsedBody.data;
  // Langy is not available on the public demo project. `evaluations:view` is
  // granted to every authenticated user there, so without this anyone could
  // drive a turn on the demo — reads are gated the same way on the REST + tRPC
  // surfaces (isDemoProjectId).
  if (isDemoProjectId(projectId)) {
    return c.json(
      { error: "Langy is not available on the demo project." },
      { status: 403 },
    );
  }
  // A regenerate RE-DRIVES the failed turn against the message already on
  // record. Anything else is a fresh send and persists its user message below.
  const isRetry = trigger === "regenerate-message";

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
  // ── PHASE 1: THE GATE ─────────────────────────────────────────────────────
  // Both checks are round trips (Postgres, Redis) and neither depends on the
  // other, so they wait together. They run BEFORE anything else: a caller who
  // fails them must not cause us to mint keys or read conversations on their
  // behalf, and their PRECEDENCE is load-bearing — a forbidden caller gets a 403,
  // not whatever the rate limiter happened to say.
  const [permission, rateLimit] = await tracer.withActiveSpan(
    "langy.chat.phase1_gate",
    { attributes: { "tenant.id": projectId, "langy.phase": "gate" } },
    async () =>
      Promise.allSettled([
        hasProjectPermission(
          { prisma, session },
          projectId,
          "evaluations:view",
        ),
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

  // Resolved only once the gate has passed: a caller who is forbidden or
  // rate-limited must not cause us to reach for the app layer at all.
  const conversationService = getApp().langy.conversations;
  const credentialService = LangyCredentialService.create(prisma);

  // ── PHASE 2: EVERYTHING THAT NEEDS ONLY THE PROJECT ───────────────────────
  // Four more independent round trips — the conversation lookup, the model
  // resolve, the session-key mint and the egress allow-list. Run serially, as
  // they were, they stacked four RTTs onto the front of every turn before the
  // agent had even been told a message existed. None depends on another.
  //
  // `allSettled`, not `all`: each failure maps to a DIFFERENT status (403 / 409),
  // and `all` would reject on the first and throw the rest away.
  const [conversationResult, model, credentialsResult, egressResult] =
    await tracer.withActiveSpan(
      "langy.chat.phase2_dependencies",
      { attributes: { "tenant.id": projectId, "langy.phase": "dependencies" } },
      async () =>
        Promise.allSettled([
          conversationService.ensureConversation({
            projectId,
            userId: session.user.id,
            conversationId: requestedConversationId ?? null,
          }),
          getVercelAIModel({ projectId }),
          // `mintSessionKey: false` — everything EXCEPT the session key. We cannot
          // yet know whether we need one: that depends on whether the manager
          // already has a live worker, and the question we must ask it (the
          // capability signature: model, GitHub-token presence, egress list) is
          // itself made of the things this call resolves. So resolve first, probe
          // second, mint only if we must. See the probe below.
          credentialService.getOrProvision({
            projectId,
            session,
            mintSessionKey: false,
          }),
          credentialService.getEgressAllowlist({ projectId }),
        ]),
    );

  // The conversation id (ownership-checked). No write happened — the aggregate is
  // created by the first SendMessage command below.
  if (conversationResult.status === "rejected") {
    if (conversationResult.reason instanceof LangyConversationNotOwnedError) {
      return c.json(handledErrorBody(conversationResult.reason), {
        status: 403,
      });
    }
    throw conversationResult.reason;
  }
  const conversation = conversationResult.value;

  const lastUserMessage = messages[messages.length - 1];

  if (model.status === "rejected") {
    // Real error in the server log; surface a generic public message to the
    // user. `error.message` could leak internals (model-provider config-store
    // internals, stack details, env hints). Sergio's 2026-06-30 review round 3.
    logger.warn({ error: model.reason, projectId }, "getVercelAIModel failed");
    return c.json(
      { error: "No model configured for this project." },
      { status: 409 },
    );
  }

  // On a RETRY the trailing user message is the SAME one the failed turn already
  // persisted — re-recording it would duplicate the user's question in the
  // conversation (a second message_sent event => a second langy_messages row and
  // a double-counted MessageCount). The turn below still runs against its text,
  // so the retry re-drives the turn without re-posting the message.
  //
  // Kicked off HERE but awaited LATER (just before the turn is dispatched): the
  // agent does not read this row — it is handed the prompt directly — so
  // persisting it is not on the critical path to a first token. It runs
  // alongside the credential mint and the guard reads below. It IS awaited before
  // `startTurn`, so the ordering that matters still holds: the message is on
  // record before the turn that answers it exists.
  const messageRecorded =
    !isRetry && lastUserMessage?.role === "user"
      ? conversationService.recordUserMessage({
          projectId,
          conversationId: conversation.id,
          userId: session.user.id,
          parts: lastUserMessage.parts,
          title: extractTextFromParts(messages[0]?.parts).slice(0, 80) || null,
        })
      : Promise.resolve(null);
  // Never let this reject unhandled while we do other work.
  messageRecorded.catch(() => undefined);

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

  // ── PHASE 3: THE CONVERSATION-SCOPED READS ────────────────────────────────
  // These two need the conversation id, so they could not join Phase 2 — but they
  // do not need each other. The busy-guard status and any pending resume handoff
  // wait together.
  const [currentResult, handoffResult] = await Promise.allSettled([
    // `findByIdVisible`, not `getById`: this is the ONE caller for which absence
    // is a real answer. A conversation whose fold has not been projected yet
    // cannot have a turn running in it, so "not there" means "not busy".
    // Everywhere else, a missing conversation is an error and must say so.
    conversationService.findByIdVisible({
      id: conversation.id,
      projectId,
      userId: session.user.id,
    }),
    conversationService.getPendingHandoff({
      projectId,
      conversationId: conversation.id,
    }),
  ]);

  if (credentialsResult.status === "rejected") {
    if (credentialsResult.reason instanceof LangyCredentialResolutionError) {
      return c.json(
        { error: credentialsResult.reason.message },
        { status: 409 },
      );
    }
    throw credentialsResult.reason;
  }
  const credentials = credentialsResult.value;

  // Resolve the project's Langy egress allow-list (ADR-043) and attach it to
  // the credentials envelope. The presence of the list is the mode: null ⇒ the
  // worker's egress adapter watches but blocks nothing; a set list ⇒ the
  // adapter restricts outbound to floor ∪ this list. It rides the same /chat
  // body every other capability does — no second channel — and is bound at
  // worker spawn (a change recycles the worker on its next turn). A drifted
  // column throws in getEgressAllowlist and fails closed here; surface a 409
  // rather than silently running with enforcement disabled.
  if (egressResult.status === "rejected") {
    logger.error(
      { error: egressResult.reason, projectId },
      "failed to resolve Langy egress allow-list",
    );
    return c.json(
      { error: "Langy egress policy is misconfigured for this project." },
      { status: 409 },
    );
  }
  if (egressResult.value) {
    credentials.egressAllowlist = egressResult.value;
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

  // ── MINT THE SESSION KEY ONLY IF A WORKER MUST ACTUALLY BE SPAWNED ────────
  //
  // The session key lives in the WORKER's process environment, injected at spawn.
  // A reused worker keeps the key it booted with — the manager reads the incoming
  // credentials only to compute the capability signature, and throws the rest
  // away on a signature match. So minting on every turn produced a key that was
  // written to the database, pushed over the wire, never read, and left valid for
  // six hours. Measured: 41 keys minted, 14 ever used, none revoked.
  //
  // The signature is computable WITHOUT a key — model, whether a GitHub token is
  // present, and the egress allow-list — which is precisely what lets us ask the
  // question before paying for the answer. So: probe, then mint only on a miss.
  //
  // The probe is ADVISORY. The worker can die in the gap between it and the turn.
  // We do not try to close that race here (we would only be guessing); the manager
  // refuses a keyless spawn with `credentials_required` and the turn processor
  // mints once and retries. A stale "alive" costs one round trip. Guessing wrong
  // in the other direction — minting defensively every time — is the bug.
  //
  // Everything here is best-effort in the safe direction: if the probe itself
  // fails, we mint, exactly as before this change.
  // The model in the worker's signature is the OVERRIDE, or empty — never the
  // resolved project default. The manager only ever assigns `creds.Model` from a
  // non-empty `modelOverride` (handlers.go: `if mo != "" { creds.Model = mo }`),
  // and the credentials envelope carries no model field of its own. Probing with
  // the resolved default would therefore compute a signature the manager never
  // holds, every probe would miss, and we would quietly mint on every turn again —
  // the optimisation would look implemented and do nothing. Mirror the manager
  // exactly.
  const workerIsLive = await probeLangyWorker({
    agentUrl,
    internalSecret,
    conversationId: conversation.id,
    model: modelOverride,
    hasGithubAuth: !!credentials.githubToken,
    egressAllowlist: credentials.egressAllowlist,
  });

  if (!workerIsLive) {
    try {
      const minted = await mintLangySessionApiKey({
        prisma,
        session,
        projectId,
        organizationId: credentials.organizationId,
      });
      credentials.langwatchApiKey = minted.token;
      credentials.langwatchApiKeyId = minted.apiKeyId;
    } catch (error) {
      if (error instanceof LangySessionKeyScopeError) {
        // The caller holds none of Langy's permissions in this project. Same
        // refusal as before, just reached later.
        return c.json({ error: error.message }, { status: 409 });
      }
      throw error;
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

  // ── HIT THE WORKER NOW ────────────────────────────────────────────────────
  // Credentials are final as of this line — the model is resolved, the egress
  // allow-list is attached, and the PR-cap decision above has settled whether
  // GH_TOKEN rides along. Those three ARE the worker's credential signature, so
  // this is the earliest moment we can warm a worker the turn will actually
  // reuse. (Warming sooner would spawn one with a different signature, which the
  // real turn then kills and respawns — slower than not warming at all.)
  //
  // Spawning opencode is the expensive half of a cold turn. Everything still
  // ahead of us — persisting the message, stashing the handoff, dispatching
  // StartAgentTurn through the event log, the outbox drain, the spawn reactor —
  // now happens WHILE the subprocess boots instead of before it. By the time the
  // reactor's /chat lands, Acquire is a map lookup.
  //
  // Fire-and-forget, deliberately: the turn does not depend on it. A warm that
  // fails, times out, or hits capacity simply means the turn cold-starts exactly
  // as it does today. It cannot duplicate the turn either — /warm Acquires but
  // never Claims or PostMessages, so it cannot start one.
  void warmLangyWorker({
    agentUrl,
    internalSecret,
    conversationId: conversation.id,
    credentials,
    modelOverride,
  });

  // Busy-guard: one turn in flight per conversation. Replaces the manager's
  // Worker.tryClaim 409 — a turn in flight means the fold status is "running".
  // Read in the parallel batch above; a failed read must not block a turn.
  const current =
    currentResult.status === "fulfilled" ? currentResult.value : null;
  if (currentResult.status === "rejected") {
    logger.warn(
      { error: currentResult.reason, conversationId: conversation.id },
      "busy-guard read failed — allowing the turn",
    );
  }
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
  // The system block the worker gets: Langy's role, then (when the user has
  // context chips up) what they are looking at, then any cap note. The page
  // context is DATA — `renderLangyPageContext` sanitises it and says so — so it
  // rides `system` rather than being concatenated into the user's prompt, which
  // is the same separation the override itself relies on.
  const system = [
    langyOverride,
    renderLangyTurnContext({ pageContext, skills }),
    capReachedNote,
  ]
    .filter((block): block is string => !!block && block.trim().length > 0)
    .join("\n\n");

  // ADR-048 resume-on-next-worker: if a prior turn checkpointed on pod shutdown,
  // it left an opaque, worker-authored resume token on the conversation fold.
  // Thread it to the fresh worker so it continues from the checkpoint instead of
  // cold-starting, then consume it once the turn has started (below). The token
  // is opaque to the control plane — read, forwarded, never interpreted. A read
  // failure degrades to a cold start; it must never block a new turn.
  // Read in the parallel batch above. A failed read degrades to a cold start; it
  // must never block a new turn.
  if (handoffResult.status === "rejected") {
    logger.warn(
      { error: handoffResult.reason, conversationId: conversation.id },
      "failed to read pending langy handoff — cold-starting",
    );
  }
  const pendingHandoff: { token: string; turnId: string } | null =
    handoffResult.status === "fulfilled" ? handoffResult.value : null;

  // Who is allowed to watch this turn's live streams — written NOW, synchronously,
  // because the browser subscribes to Stream B the instant it reads the turn-id
  // header and the conversation's ClickHouse fold will not exist for seconds yet.
  // Gating on that fold is what made the fast path 404 on every first turn, for
  // the life of the feature. Separate from the spawn handoff below, which the
  // spawn reactor DELETES on take() and so can vanish before the browser asks.
  const accessStore = createLangyTurnAccessStore({ redis: connection });
  await accessStore.grant({
    projectId,
    conversationId: conversation.id,
    turnId,
    userId: session.user.id,
  });

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
    ...(pendingHandoff ? { resumeToken: pendingHandoff.token } : {}),
  });

  // The ordering that MATTERS: the user's message must be on record before the
  // turn that answers it exists. It has been in flight since well before the
  // credential mint (see `messageRecorded`), so this await is almost always
  // already-settled — it buys the invariant without buying the latency.
  try {
    await messageRecorded;
  } catch (error) {
    await releaseReservedPermit();
    logger.error({ error }, "failed to record the langy user message");
    return c.json({ error: "Agent request failed" }, { status: 502 });
  }

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

  // ADR-048: the resume token is now threaded to the new worker — clear it so it
  // is consumed exactly once. Keyed on the handed-off turn (idempotent), so a
  // rare double-read collapses to one durable event. Best-effort: a failure
  // leaves the token pending for the next turn to re-consume (still idempotent),
  // and opencode's resume is itself idempotent, so at worst it is applied twice.
  if (pendingHandoff) {
    await conversationService
      .consumeHandoff({
        projectId,
        conversationId: conversation.id,
        turnId: pendingHandoff.turnId,
      })
      .catch((error) =>
        logger.warn(
          { error, conversationId: conversation.id },
          "failed to consume langy handoff",
        ),
      );
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

      // Translate the turn's live-edge entries into UI-message parts. Text is the
      // prose; TOOL entries become real AI-SDK tool parts (so the browser's
      // existing tool-card renderer draws them, live and identically on reload);
      // status/progress ride as `data-*` parts; and a terminal `error` entry
      // becomes a structured error PART carrying the serialized domain error
      // (`readLangyStreamError` parses it into a calm error card). Previously
      // everything but `delta` was dropped — tool activity never reached the UI
      // and a hard failure ended the stream silently.
      const emit = (entry: LangyStreamEntry) => {
        switch (entry.type) {
          case "delta":
            writer.write({ type: "text-delta", delta: entry.text, id: textId });
            return;
          case "tool":
            if (entry.phase === "start") {
              writer.write({
                type: "tool-input-available",
                toolCallId: entry.id,
                toolName: entry.name,
                input: entry.input ?? {},
              });
              return;
            }
            if (entry.isError) {
              writer.write({
                type: "tool-output-error",
                toolCallId: entry.id,
                errorText: entry.output ?? "Tool call failed",
              });
              return;
            }
            writer.write({
              type: "tool-output-available",
              toolCallId: entry.id,
              output: entry.output ?? "",
            });
            return;
          case "status":
            writer.write({
              type: "data-langy-status",
              id: "langy-status",
              data: { status: entry.status },
            });
            return;
          case "progress":
            writer.write({
              type: "data-langy-progress",
              id: "langy-progress",
              data: {
                ...(entry.message !== undefined
                  ? { message: entry.message }
                  : {}),
                ...(entry.progress !== undefined
                  ? { progress: entry.progress }
                  : {}),
              },
            });
            return;
          case "milestone":
            writer.write({
              type: "data-langy-milestone",
              data: {
                kind: entry.kind,
                ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
              },
            });
            return;
          case "error":
            // `entry.error` is the JSON domain error the worker serialized.
            writer.write({ type: "error", errorText: entry.error });
            return;
          default:
            return;
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
/**
 * May this caller watch this turn's live stream?
 *
 * TWO gates, in the order that makes the fast path actually work.
 *
 *   1. The TURN-ACCESS record (Redis, written synchronously in the POST before
 *      the turn dispatched). Answers "did this user start this turn?" instantly.
 *   2. The conversation FOLD, for everything else — a shared conversation, a
 *      resumed turn, a refresh long after the window.
 *
 * Gate 2 alone is what broke Stream B. The fold is a ClickHouse projection off
 * the event log and lands SECONDS after the turn starts, but the browser
 * subscribes the moment it reads `x-langy-turn-id`. So on the first turn of any
 * conversation the fold did not exist, `getById` returned null, and this route
 * answered 404 — every time, for the life of the feature, in a product that is
 * overwhelmingly first turns. The fast path never once ran.
 *
 * Gate 1 does not widen access: it only ever confirms the turn's own actor, in
 * the same project. Anyone else still has to satisfy the fold's visibility rule.
 */
async function canWatchTurn({
  projectId,
  conversationId,
  turnId,
  userId,
}: {
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
}): Promise<boolean> {
  if (connection) {
    const access = createLangyTurnAccessStore({ redis: connection });
    if (
      await access.isTurnActor({ projectId, conversationId, turnId, userId })
    ) {
      return true;
    }
  }
  // No fast answer — fall back to the durable visibility rule. `getById` THROWS
  // when the conversation is not there (or not theirs); absence is an answer
  // here, not an error, so tolerate it explicitly.
  const conv = await getApp().langy.conversations.findByIdVisible({
    id: conversationId,
    projectId,
    userId,
  });
  return !!conv;
}

langyRoute().get("/langy/conversations/:id/stream", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const turnId = c.req.query("turnId");
  if (!turnId) {
    return c.json({ error: "Missing turnId" }, { status: 400 });
  }
  if (
    !(await canWatchTurn({
      projectId: projectId!,
      conversationId: id,
      turnId,
      userId: guard.session!.user.id,
    }))
  ) {
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
// Stream B — raw token fast-path (ADR-048)
// ============================================================================

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Disable proxy buffering so tokens are not held back (nginx/ingress).
  "X-Accel-Buffering": "no",
} as const;

/**
 * Bridge a turn's ephemeral fast-token pub/sub channel to a Server-Sent Events
 * stream (ADR-048, Stream B). Each raw token is forwarded verbatim as one SSE
 * `data:` frame carrying the `{"d":...}` / `{"e":1}` wire shape the browser
 * validates with `fastFrameSchema`. Pub/sub, so nothing replays: this is the
 * speed channel, not the truth. The stream ends on the terminal frame, the
 * turn-timeout bound, or client disconnect — whichever comes first.
 */
function createFastTokenStream({
  redis,
  conversationId,
  turnId,
  signal,
}: {
  redis: unknown;
  conversationId: string;
  turnId: string;
  signal: AbortSignal | undefined;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let subscription: { close: () => void } | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const frame = (payload: string) => encoder.encode(`data: ${payload}\n\n`);

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (timeout) clearTimeout(timeout);
        subscription?.close();
        signal?.removeEventListener("abort", shutdown);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      if (signal?.aborted) {
        shutdown();
        return;
      }
      signal?.addEventListener("abort", shutdown);

      subscription = subscribeFastTokens({
        // ioredis satisfies the module's minimal subscriber surface; cast at the
        // transport boundary rather than leaking ioredis into the service type.
        redis: redis as Parameters<typeof subscribeFastTokens>[0]["redis"],
        conversationId,
        turnId,
        onToken: (text) => {
          if (closed) return;
          controller.enqueue(frame(JSON.stringify({ d: text })));
        },
        onEnd: () => {
          if (closed) return;
          controller.enqueue(frame(JSON.stringify({ e: 1 })));
          shutdown();
        },
      });

      // Bound the fast stream to the turn budget so a wedged worker can't hold
      // the SSE open forever; the durable stream + reconcile sweep own recovery.
      timeout = setTimeout(shutdown, AGENT_CHAT_TIMEOUT_MS);
    },
  });
}

langyRoute().get("/langy/conversations/:id/fast", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const turnId = c.req.query("turnId");
  if (!turnId) {
    return c.json({ error: "Missing turnId" }, { status: 400 });
  }

  // Ownership gate. THIS is the 404 that killed the fast path: it used to read
  // the conversation FOLD, which had not been projected yet on a first turn, so
  // Stream B 404'd on every new conversation and silently never ran.
  if (
    !(await canWatchTurn({
      projectId: projectId!,
      conversationId: id,
      turnId,
      userId: guard.session!.user.id,
    }))
  ) {
    return c.json(handledErrorBody(new LangyConversationNotFoundError(id)), {
      status: 404,
    });
  }

  if (!connection) {
    // No pub/sub transport — return an immediately-ended SSE so the browser
    // falls back to Stream A without hanging.
    const encoder = new TextEncoder();
    const empty = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ e: 1 })}\n\n`),
        );
        controller.close();
      },
    });
    return new Response(empty, { headers: SSE_HEADERS });
  }

  const stream = createFastTokenStream({
    redis: connection,
    conversationId: id,
    turnId,
    signal: c.req.raw.signal,
  });
  return new Response(stream, { headers: SSE_HEADERS });
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
  if (isDemoProjectId(projectId)) {
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
  let conv;
  try {
    conv = await convService.getById({
      id,
      projectId: projectId!,
      userId: guard.session!.user.id,
    });
  } catch (error) {
    if (LangyConversationNotFoundError.is(error)) {
      return c.json(handledErrorBody(error), { status: 404 });
    }
    throw error;
  }
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

/**
 * The agent manager reports that a worker has died, so the session key that died
 * with it can stop being a live credential.
 *
 * REVOKE ONLY. There is deliberately no minting counterpart here. The manager is
 * trusted to *hold* a key it was handed, not to manufacture one: a mint endpoint
 * behind this same secret would let whoever holds it create credentials for any
 * user in any project they can name, which is a trust-boundary change and not
 * something a latency optimisation gets to introduce. Revocation is fail-closed —
 * the worst a compromised manager can do with this is destroy its own access.
 *
 * `revokeLangySessionApiKey` narrows it further still: it refuses any key that is
 * not a Langy session key, so a bad or malicious id cannot take a customer's
 * personal or ingestion keys offline.
 *
 * Idempotent, and "already gone" is a success: the manager races the expiry
 * reaper, and a key the reaper collected first must not look like a failure.
 */
langyRoute().post("/langy/credentials/revoke", async (c) => {
  const internalSecret = process.env.LANGY_INTERNAL_SECRET;
  if (!internalSecret) {
    logger.error("LANGY_INTERNAL_SECRET is not configured");
    return c.json({ error: "Not configured" }, { status: 503 });
  }
  if (
    !isLangyInternalCallerAuthorized(
      c.req.header("authorization"),
      internalSecret,
    )
  ) {
    return c.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = revokeCredentialsSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, { status: 400 });
  }

  const outcome = await revokeLangySessionApiKey({
    prisma,
    apiKeyId: parsed.data.apiKeyId,
  });

  switch (outcome) {
    case "revoked":
    case "already_revoked":
      return c.json({ outcome }, { status: 200 });
    case "not_found":
      // 404, which the manager treats as success — the key is in the state it
      // asked for. Anything else would make the reaper winning the race look
      // like a fault.
      return c.json({ outcome }, { status: 404 });
    case "refused":
      // The id resolved to a key that is not ours. Refused, and loud: this should
      // never happen in normal operation.
      return c.json({ error: "Not a Langy session key" }, { status: 403 });
  }
});

const revokeCredentialsSchema = z.object({
  apiKeyId: z.string().min(1).max(128),
});

/**
 * Constant-time bearer check against the shared manager secret. A plain `===`
 * leaks the secret one byte at a time to anything that can time our responses,
 * and this endpoint is reachable from inside the cluster.
 */
function isLangyInternalCallerAuthorized(
  authorizationHeader: string | undefined,
  expected: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expectedBuf = Buffer.from(expected);
  if (presented.length !== expectedBuf.length) return false;
  return timingSafeEqual(presented, expectedBuf);
}

export const app = secured.hono;
