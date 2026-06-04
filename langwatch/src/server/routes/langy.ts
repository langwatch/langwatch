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
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { z } from "zod";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { featureFlagService } from "~/server/featureFlag";
import { isLangwatchStaff } from "~/utils/isLangwatchStaff";
import { createLogger } from "~/utils/logger/server";
import { auditLog } from "~/server/auditLog";
import { TiktokenClient } from "~/server/app-layer/clients/tokenizer/tiktoken.client";
import {
  LangyConversationNotOwnedError,
  LangyConversationService,
  LangyCredentialResolutionError,
  LangyCredentialService,
  LangyMessageService,
} from "~/server/services/langy";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:api:langy");

const LANGY_FALLBACK_MODEL = "openai/gpt-5-mini";

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
});
type ChatMessage = z.infer<typeof chatMessageSchema>;

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
  message: ChatMessage;
  model: string;
}) {
  const text =
    Array.isArray(opts.message.parts) && opts.message.parts.length
      ? extractAssistantText(opts.message.parts)
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

// Every Langy route does its own authentication in-handler: the app-level
// guard below validates the session + isLangwatchStaff + release_langy_enabled,
// and each handler additionally checks the project-scoped evaluations:view
// permission. We register through the SecuredApp builder with handlerManagedAuth
// so the routes declare a policy (the auth guarantee test requires every
// concrete endpoint to be classified) while keeping that in-handler enforcement.
const LANGY_HANDLER_AUTH_REASON =
  "Staff-gated UI route: session + isLangwatchStaff + release_langy_enabled " +
  "enforced by the app-level guard; project evaluations:view checked per-handler.";

const secured = createServiceApp({ basePath: "/api" });

secured.hono.use("/langy/*", async (c, next) => {
  await getServerAuthSession({ req: c.req.raw as any });
  await next();
});

// Thin helper so each route reads `langyRoute().<verb>(path, handler)`.
const langyRoute = () =>
  secured.access(handlerManagedAuth(LANGY_HANDLER_AUTH_REASON));

langyRoute().post("/langy/chat", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
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

  const conversationService = LangyConversationService.create(prisma);

  let conversation;
  try {
    conversation = await conversationService.ensureConversation({
      projectId,
      userId: session.user.id,
      conversationId: requestedConversationId ?? null,
      title:
        messages[0] && extractAssistantText(messages[0].parts)
          ? extractAssistantText(messages[0].parts).slice(0, 80)
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

  try {
    await getVercelAIModel(projectId);
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
    await persistUserMessage({
      conversationId: conversation.id,
      projectId,
      message: lastUserMessage,
      model: LANGY_FALLBACK_MODEL,
    });
  }

  const userText = extractAssistantText(lastUserMessage?.parts);

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
  try {
    const credentialService = LangyCredentialService.create(prisma);
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

  const agentResponse = await fetch(`${agentUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${internalSecret}`,
    },
    body: JSON.stringify({
      conversationId: conversation.id,
      prompt: userText,
      system: langyOverride,
      credentials,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!agentResponse.ok) {
    logger.error({ status: agentResponse.status }, "opencode agent request failed");
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
            writer.write({ type: "text-delta", delta: event.part.text, id: textId });
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

async function requireSessionAndPermission(c: any, projectId: string | undefined) {
  const session = await getServerAuthSession({ req: c.req.raw as any });
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
