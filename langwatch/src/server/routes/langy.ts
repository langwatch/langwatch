/**
 * Hono routes for the Langy assistant.
 *
 * Only surface left: `POST /api/langy/chat` — the turn-START endpoint. It does
 * the auth + rate-limit + credential/permit/warm/handoff pipeline and dispatches
 * the `StartAgentTurn` command, then returns `{conversationId, turnId}`. It no
 * longer streams: the browser subscribes to the `langy.onTurnStream` tRPC
 * subscription for the live turn, and reads/lists/deletes go through the
 * `api.langy.*` tRPC router. The old streaming (`/stream`, `/fast`) + REST
 * conversations-CRUD + `/memory` endpoints were deleted with the transport
 * migration. (This handler's pipeline is still the pre-extraction one; the
 * planned move into an app-layer service + repository is deferred.)
 *
 * Access: LangWatch staff always have Langy. For everyone else it is gated by
 * `release_langy_enabled`, which is the lever for opening Langy beyond staff
 * (see the middleware below). Staff therefore bypass the flag entirely.
 */
import type { Context } from "hono";
import { z } from "zod";
import {
  LangySessionKeyScopeError,
  mintLangySessionApiKey,
} from "~/server/services/langy/langyApiKey";
import { env } from "~/env.mjs";
import { hasProjectPermission, isDemoProjectId } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";

import { featureFlagService } from "~/server/featureFlag";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";

import {
  LANGY_GITHUB_PRS_PER_DAY,
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
import type { DomainError } from "~/server/app-layer/domain-error";
import { LangyConversationNotOwnedError } from "~/server/app-layer/langy/errors";
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

  // The turn is now dispatched. Streaming moved to the tRPC `langy.onTurnStream`
  // subscription (which reads the SAME durable token buffer this route used to
  // attach to), so this endpoint just returns the ids the client needs to
  // subscribe. The custom AI-SDK ChatTransport reads this JSON, then subscribes.
  //
  // (This route's turn-start pipeline is still the janky pre-extraction one; the
  // planned move into an app-layer service + repository is deferred.)
  return c.json({ conversationId: conversation.id, turnId });
});

export const app = secured.hono;
