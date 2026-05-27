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
 * Every route is gated by `isLangwatchStaff(email)` AND
 * `release_langy_enabled` (see the middleware below).
 */
import { generate } from "@langwatch/ksuid";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { Hono, type Context } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import { createLogger } from "~/utils/logger/server";
import { auditLog } from "~/server/auditLog";
import { TiktokenClient } from "~/server/app-layer/clients/tokenizer/tiktoken.client";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  LangyConversationNotOwnedError,
  LangyConversationService,
  LangyCredentialResolutionError,
  LangyCredentialService,
  LangyMessageService,
} from "~/server/services/langy";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";
import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:langy");

const LANGY_FALLBACK_MODEL = "openai/gpt-5-mini";

// User-facing strings for the structured error events the pod's manager
// emits. Anything not in this map falls through to the raw error string.
const AGENT_ERROR_MESSAGES: Record<string, string> = {
  "at-capacity":
    "Langy is at capacity right now. Please retry in a minute.",
  "turn-in-flight":
    "Previous message is still being processed. Please wait for it to finish before sending another.",
  "session-not-found":
    "Conversation session expired on the agent. Send your message again to start a fresh session.",
};

function extractAssistantText(
  parts: Array<Record<string, unknown>> | undefined,
): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p?.text === "string" ? (p.text as string) : ""))
    .filter(Boolean)
    .join("\n");
}

async function persistAssistantMessage(opts: {
  conversationId: string;
  projectId: string;
  parts: unknown;
  text: string;
  model: string;
}) {
  const tokenizer = new TiktokenClient();
  const tokenCount = (await tokenizer.countTokens(opts.model, opts.text)) ?? null;
  const messageService = LangyMessageService.create(prisma);
  await messageService.append({
    conversationId: opts.conversationId,
    projectId: opts.projectId,
    role: "assistant",
    parts: opts.parts ?? [],
    tokenCount,
  });
  const conversationService = LangyConversationService.create(prisma);
  await conversationService.touch({
    id: opts.conversationId,
    projectId: opts.projectId,
  });
}

async function persistUserMessage(opts: {
  conversationId: string;
  projectId: string;
  message: UIMessage;
  model: string;
}) {
  const text =
    Array.isArray(opts.message.parts) && opts.message.parts.length
      ? extractAssistantText(opts.message.parts as Array<Record<string, unknown>>)
      : "";
  const tokenizer = new TiktokenClient();
  const tokenCount = (await tokenizer.countTokens(opts.model, text)) ?? null;
  const messageService = LangyMessageService.create(prisma);
  await messageService.append({
    conversationId: opts.conversationId,
    projectId: opts.projectId,
    role: "user",
    parts: opts.message.parts ?? [],
    tokenCount,
  });
}

// The pod's AGENTS.md is written for CLI/codebase instrumentation (the
// OpenCode default), not in-product Langy. We override with a Langy-
// specific system block, phrased to fit the MCP tool catalog the pod
// actually has. Sent as `system` (not concatenated into the user prompt)
// so the model treats it as instructions, not user content — lower
// jailbreak risk and cleaner separation.
const LANGY_SYSTEM_OVERRIDE = [
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

// Gate one /langy/chat request: project permission + rate limit.
// Returns a Response on failure (caller returns it directly) or null on
// success.
async function gateLangyChatRequest({
  c,
  session,
  projectId,
}: {
  c: Context;
  session: { user: { id: string } };
  projectId: string;
}): Promise<Response | null> {
  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:view",
  );
  if (!hasPermission) {
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
  return null;
}

// Parse one NDJSON event line into a known shape, or undefined if junk.
// Pulled out of the stream loop so the loop reads as orchestration.
interface AgentEvent {
  type: string;
  error?: string;
  part?: { type?: string; text?: string };
  properties?: {
    field?: string;
    delta?: string;
    part?: { type?: string; text?: string };
  };
}
function parseAgentEventLine(line: string): AgentEvent | undefined {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as AgentEvent;
  } catch {
    return undefined;
  }
}

// Map one parsed event to a text delta (or null if it's not text-bearing).
// Owns the legacy/opencode/error-event branching that used to be inline
// in the stream loop.
function eventToTextDelta(
  event: AgentEvent,
  ctx: { conversationId: string },
): string | null {
  // Manager-emitted error events (at-capacity, turn-in-flight,
  // session-not-found, generic). Without explicit handling these
  // silently terminate the stream and the user sees an empty assistant
  // reply. Surface as a visible delta + log.
  if (event.type === "error") {
    const errMsg = event.error ?? "agent error";
    logger.warn(
      { error: errMsg, conversationId: ctx.conversationId },
      "opencode agent returned error event",
    );
    const userMessage = AGENT_ERROR_MESSAGES[errMsg] ?? errMsg;
    return `\n\n_${userMessage}_`;
  }
  // Legacy shape (kept for older agent versions).
  if (event.type === "text" && event.part?.text) {
    return event.part.text;
  }
  // OpenCode shape: text deltas arrive as message.part.delta with field=text.
  if (
    event.type === "message.part.delta" &&
    event.properties?.field === "text" &&
    typeof event.properties?.delta === "string"
  ) {
    return event.properties.delta;
  }
  return null;
}

// Build the AI-SDK UI message stream that relays an opencode pod's
// NDJSON event stream into text-delta events for the browser, then
// persists the assembled assistant message on completion.
function buildAgentRelayStream({
  agentResponse,
  conversation,
  projectId,
}: {
  agentResponse: Response;
  conversation: { id: string };
  projectId: string;
}) {
  const textId = generate(KSUID_RESOURCES.EVENT).toString();
  let fullText = "";

  return createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "text-start", id: textId });

      const reader = agentResponse.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = parseAgentEventLine(line);
          if (!event) continue;
          const delta = eventToTextDelta(event, {
            conversationId: conversation.id,
          });
          if (delta === null) continue;
          fullText += delta;
          writer.write({ type: "text-delta", delta, id: textId });
        }
      }

      writer.write({ type: "text-end", id: textId });

      try {
        await persistAssistantMessage({
          conversationId: conversation.id,
          projectId,
          parts: [{ type: "text", text: fullText, role: "assistant" }],
          text: fullText,
          model: "opencode",
        });
      } catch (error) {
        logger.error({ error }, "failed to persist langy assistant message");
      }
    },
    onError: (error) => {
      logger.error({ error }, "error in opencode agent stream");
      return "An error occurred while processing your request.";
    },
  });
}

export const app = new Hono().basePath("/api");
app.use(tracerMiddleware({ name: "langy" }));
app.use(loggerMiddleware());
app.use("/langy/*", async (c, next) => {
  const session = await getServerAuthSession({ req: c.req.raw as NextRequestShim });
  if (!isLangwatchStaff(session?.user?.email)) {
    return c.json({ error: "Langy is not available for your account" }, 403);
  }
  const enabled = await featureFlagService.isEnabled("release_langy_enabled", {
    distinctId: session?.user?.id ?? "",
  });
  if (!enabled) {
    return c.json({ error: "Langy is not currently enabled" }, 403);
  }
  await next();
});

app.post("/langy/chat", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as NextRequestShim });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const {
    messages,
    projectId,
    conversationId: requestedConversationId,
  } = (await c.req.json()) as {
    messages: UIMessage[];
    projectId: string;
    conversationId?: string | null;
  };
  if (!projectId) {
    return c.json({ error: "Missing projectId" }, { status: 400 });
  }

  const agentUrl = process.env.OPENCODE_AGENT_URL;
  const internalSecret = process.env.LANGY_INTERNAL_SECRET;
  if (!agentUrl || !internalSecret) {
    logger.error(
      { agentUrl: !!agentUrl, internalSecret: !!internalSecret },
      "OPENCODE_AGENT_URL or LANGY_INTERNAL_SECRET not configured",
    );
    return c.json({ error: "Agent not configured" }, { status: 503 });
  }

  const gateError = await gateLangyChatRequest({ c, session, projectId });
  if (gateError) return gateError;

  // Resolve credentials before persisting anything — if no provider
  // credential is configured the user gets a 409 instead of an
  // orphaned user message with no reply.
  let credentials;
  try {
    credentials = await LangyCredentialService.create(prisma).getOrProvision({
      projectId,
      actorUserId: session.user.id,
    });
  } catch (error) {
    if (error instanceof LangyCredentialResolutionError) {
      return c.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  let conversation;
  try {
    conversation = await LangyConversationService.create(prisma).ensureConversation({
      projectId,
      userId: session.user.id,
      conversationId: requestedConversationId ?? null,
      title:
        messages[0] && extractAssistantText(messages[0].parts as Array<Record<string, unknown>>)
          ? extractAssistantText(messages[0].parts as Array<Record<string, unknown>>).slice(0, 80)
          : null,
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
  if (lastUserMessage?.role === "user") {
    await persistUserMessage({
      conversationId: conversation.id,
      projectId,
      message: lastUserMessage,
      model: LANGY_FALLBACK_MODEL,
    });
  }
  const userText = extractAssistantText(
    lastUserMessage?.parts as Array<Record<string, unknown>> | undefined,
  );

  const agentResponse = await fetch(`${agentUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${internalSecret}`,
    },
    body: JSON.stringify({
      conversationId: conversation.id,
      prompt: userText,
      system: LANGY_SYSTEM_OVERRIDE,
      credentials,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!agentResponse.ok) {
    logger.error({ status: agentResponse.status }, "opencode agent request failed");
    return c.json({ error: "Agent request failed" }, { status: 502 });
  }

  const stream = buildAgentRelayStream({ agentResponse, conversation, projectId });
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

async function requireSessionAndPermission(c: Context, projectId: string | undefined) {
  const session = await getServerAuthSession({ req: c.req.raw as NextRequestShim });
  if (!session) return { error: c.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!projectId) return { error: c.json({ error: "Missing projectId" }, { status: 400 }) };
  const ok = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:view",
  );
  if (!ok) return { error: c.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

app.get("/langy/conversations", async (c) => {
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

app.get("/langy/conversations/:id", async (c) => {
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
  const messages = await msgService.getAllByConversation({
    conversationId: conv.id,
    projectId: projectId!,
  });
  return c.json({ conversation: conv, messages });
});

app.patch("/langy/conversations/:id", async (c) => {
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

app.delete("/langy/conversations/:id", async (c) => {
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

app.delete("/langy/memory", async (c) => {
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

app.get("/langy/memory/export", async (c) => {
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

