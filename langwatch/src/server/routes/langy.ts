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
import {
  hasProjectPermission,
  type Permission,
  Resources,
} from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { auditLog } from "~/server/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";
import {
  LANGY_GITHUB_PRS_PER_DAY,
  releaseLangyGithubPrPermit,
  reserveLangyGithubPrPermit,
} from "~/server/middleware/rate-limit-langy-github-prs";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { extractOpenedPrLinks } from "~/server/services/langy/githubPrLinks";
import {
  LangyConversationNotOwnedError,
  LangyConversationService,
} from "~/server/services/langy/LangyConversationService";
import {
  LangyCredentialResolutionError,
  LangyCredentialService,
} from "~/server/services/langy/LangyCredentialService";
import {
  extractTextFromParts,
  LangyMessageService,
} from "~/server/services/langy/LangyMessageService";
import { stripLangySentinels } from "~/server/services/langy/langySentinels";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import { createLogger } from "~/utils/logger/server";
import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:langy");

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
// Token counts live on the gateway-emitted OTel trace (see the per-worker
// OPENCODE_OTLP_* env in services/langy-agent — the OpenCode OTel plugin
// exports gen_ai.usage.{prompt,completion}_tokens for every LLM call). The
// LangyMessage row is the text+role+parts of a chat turn; consumers that need
// usage figures should fold the trace by langwatch.thread.id=conversationId,
// not double-count with an in-process tokenizer here. Discussed on PR #4913.
async function persistMessage(opts: {
  conversationId: string;
  projectId: string;
  role: "user" | "assistant";
  parts: unknown;
}) {
  const messageService = LangyMessageService.create(prisma);
  await messageService.append({
    conversationId: opts.conversationId,
    projectId: opts.projectId,
    role: opts.role,
    parts: opts.parts ?? [],
  });
  if (opts.role === "assistant") {
    const conversationService = LangyConversationService.create(prisma);
    await conversationService.touch({
      id: opts.conversationId,
      projectId: opts.projectId,
    });
  }
}

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
  if (!isLangwatchStaff(session.user.email)) {
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

  // Authorise against every capability the Langy service key carries, not
  // just evaluations:view. The previous gate let a read-only user reach a
  // worker that holds an admin-equivalent service key; this loop closes the
  // privilege escalation. Each failing permission is checked sequentially —
  // chat is not hot-path traffic, and the first deny short-circuits.
  for (const required of LANGY_REQUIRED_PERMISSIONS) {
    const ok = await hasProjectPermission(
      { prisma, session },
      projectId,
      required,
    );
    if (!ok) {
      return c.json(
        {
          error: "You do not have permission to use Langy for this project.",
        },
        { status: 403 },
      );
    }
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

  const conversationService = LangyConversationService.create(prisma);

  let conversation;
  try {
    conversation = await conversationService.ensureConversation({
      projectId,
      userId: session.user.id,
      conversationId: requestedConversationId ?? null,
      title: extractTextFromParts(messages[0]?.parts).slice(0, 80) || null,
    });
  } catch (error) {
    if (error instanceof LangyConversationNotOwnedError) {
      return c.json(
        { error: "Conversation belongs to another user." },
        { status: 403 },
      );
    }
    throw error;
  }

  const lastUserMessage = messages[messages.length - 1];

  try {
    await getVercelAIModel({ projectId });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No model configured for this project.",
      },
      { status: 409 },
    );
  }

  if (lastUserMessage?.role === "user") {
    await persistMessage({
      conversationId: conversation.id,
      projectId,
      role: "user",
      parts: lastUserMessage.parts,
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
      actorUserId: session.user.id,
    });
  } catch (error) {
    if (error instanceof LangyCredentialResolutionError) {
      return c.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // Per-user daily PR cap, enforced by atomic permit reservation BEFORE we
  // hand the worker a GitHub token. If we're over cap, we strip the token
  // from `credentials` below so the worker physically cannot `gh pr create`
  // (no GH_TOKEN env in the subprocess) — the system note is a courtesy
  // explanation, not the authorisation boundary. If the turn ends without
  // opening any PR (read-only chat), the permit is released post-stream so
  // a permit isn't burned by a question.
  const permit = await reserveLangyGithubPrPermit({ userId: session.user.id });
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
  // means spawnWorker omits GH_TOKEN + GITHUB_LOGIN from the subprocess env
  // (services/langy-agent/server.js conditionally spreads them based on
  // truthiness), so the worker cannot reach github.com with an authenticated
  // token even if it ignores the system note.
  if (!permit.allowed) {
    delete (credentials as { githubToken?: string }).githubToken;
    delete (credentials as { githubLogin?: string }).githubLogin;
  }

  // Defense in depth: when a `modelOverride` rides in, enforce the project's
  // Langy VK allowlist HERE — don't trust the picker UI to gate it. If the VK
  // has no allowlist (modelsAllowed=null), the gateway is still the final
  // enforcer; this check only rejects values the project has explicitly NOT
  // allowed. The org is taken from `credentials` (the resolver already
  // returned it) so we don't refetch the project — no risk of a TOCTOU race
  // silently skipping the check between calls.
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

  const agentResponse = await fetch(`${agentUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${internalSecret}`,
    },
    body: JSON.stringify({
      conversationId: conversation.id,
      prompt: userText,
      system: capReachedNote
        ? `${langyOverride}\n\n${capReachedNote}`
        : langyOverride,
      credentials,
      // Forwarded for the agent to thread through to the gateway as the
      // `model` parameter when its support lands. Today the agent ignores
      // unrecognized fields, so this is effectively a wire-up that doesn't
      // change behavior — but the user's picker choice rides through.
      ...(modelOverride ? { modelOverride } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!agentResponse.ok) {
    logger.error(
      { status: agentResponse.status },
      "opencode agent request failed",
    );
    return c.json({ error: "Agent request failed" }, { status: 502 });
  }

  const textId = crypto.randomUUID();
  let fullText = "";

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "text-start", id: textId });

      const reader = agentResponse.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as {
            type: string;
            part?: { type?: string; text?: string };
            properties?: {
              field?: string;
              delta?: string;
              part?: { type?: string; text?: string };
            };
          };
          // Legacy shape (kept for older agent versions).
          if (event.type === "text" && event.part?.text) {
            fullText += event.part.text;
            writer.write({
              type: "text-delta",
              delta: event.part.text,
              id: textId,
            });
            return;
          }
          // OpenCode shape: text deltas arrive as message.part.delta with field=text.
          if (
            event.type === "message.part.delta" &&
            event.properties?.field === "text" &&
            typeof event.properties?.delta === "string"
          ) {
            fullText += event.properties.delta;
            writer.write({
              type: "text-delta",
              delta: event.properties.delta,
              id: textId,
            });
          }
        } catch {
          // Ignore malformed/partial JSON lines from the agent stream.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          handleLine(line);
        }
      }
      // Flush the trailing record when the stream ends without a final newline,
      // otherwise the last delta is silently dropped and the reply is truncated.
      if (buffer.trim()) handleLine(buffer);

      writer.write({ type: "text-end", id: textId });

      // Strip every Langy sentinel ([langy:connect-github] + [langy:progress:...])
      // from the persisted body — they're wire-protocol for the live UI, not
      // history. Persisting them re-triggers the connect card on history reload
      // and pollutes GDPR exports. Keep `fullText` unchanged for PR-URL
      // extraction below: PR URLs live in prose, not sentinels.
      const persistedText = stripLangySentinels(fullText);
      try {
        await persistMessage({
          conversationId: conversation.id,
          projectId,
          role: "assistant",
          parts: [{ type: "text", text: persistedText, role: "assistant" }],
        });
      } catch (error) {
        logger.error({ error }, "failed to persist langy assistant message");
      }

      // Audit each PR the assistant actually OPENED this turn — links are
      // cross-referenced against the skill's `[langy:progress:opened:...]`
      // sentinels so merely *mentioning* a PR ("summarize PR #4751") doesn't
      // forge a `pr_opened` audit entry. Parse from `fullText` (pre-strip) —
      // sentinels are gone from `persistedText`.
      //
      // Counting is owned by the pre-turn `reserveLangyGithubPrPermit` (one
      // permit per turn, atomic). If the turn opened MORE than one PR, the
      // permit covers the first; further PRs are still audited but won't
      // double-bump the daily counter. If the turn opened ZERO PRs, we
      // release the permit so a question doesn't burn a permit.
      try {
        const links = extractOpenedPrLinks(fullText);
        if (links.length === 0 && permit.allowed) {
          await releaseLangyGithubPrPermit({ userId: session.user.id });
        }
        for (const link of links) {
          await auditLog({
            userId: session.user.id,
            projectId,
            action: "langy.github.pr_opened",
            args: {
              owner: link.owner,
              repo: link.repo,
              number: link.number,
              url: link.url,
            },
          });
        }
      } catch (error) {
        logger.error({ error }, "failed to record langy github PR usage");
      }
    },
    onError: (error) => {
      logger.error({ error }, "error in opencode agent stream");
      return "An error occurred while processing your request.";
    },
  });

  const streamResponse = createUIMessageStreamResponse({ stream });
  const headers = new Headers(streamResponse.headers);
  headers.set("x-langy-conversation-id", conversation.id);
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
  const service = LangyConversationService.create(prisma);
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
  const convService = LangyConversationService.create(prisma);
  const conv = await convService.getById({
    id,
    projectId: projectId!,
    userId: guard.session!.user.id,
  });
  if (!conv) return c.json({ error: "Not found" }, { status: 404 });
  const msgService = LangyMessageService.create(prisma);
  const messages = await msgService.getRecordsByConversation({
    conversationId: conv.id,
    projectId: projectId!,
  });
  return c.json({ conversation: conv, messages });
});

langyRoute().patch("/langy/conversations/:id", async (c) => {
  const body = (await c.req.json()) as {
    projectId: string;
    title?: string | null;
    isShared?: boolean;
  };
  const guard = await requireSessionAndPermission(c, body.projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const service = LangyConversationService.create(prisma);
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
  } catch {
    return c.json({ error: "Not found or not owned" }, { status: 404 });
  }
});

langyRoute().delete("/langy/conversations/:id", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const id = c.req.param("id");
  const service = LangyConversationService.create(prisma);
  const ok = await service.deleteById({
    id,
    projectId: projectId!,
    userId: guard.session!.user.id,
  });
  if (!ok) return c.json({ error: "Not found or not owned" }, { status: 404 });
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
  const convService = LangyConversationService.create(prisma);
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
  const convService = LangyConversationService.create(prisma);
  const conversations = await convService.getAll({
    projectId: projectId!,
    userId,
    limit: 1000,
  });
  const msgService = LangyMessageService.create(prisma);
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
