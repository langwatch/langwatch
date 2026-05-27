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
 *   GET/PUT/POST /langy/project-memory*      — read / edit (admin) / refresh
 *                                              the per-project memory file.
 *                                              Refresh runs in-process via
 *                                              the Vercel AI SDK, not the pod.
 *   GET/PUT /langy/preferences               — per-user mode + dismissed
 *                                              suggestion kinds.
 *   DELETE /langy/memory                     — clear all of a user's Langy
 *                                              data for a project.
 *   GET    /langy/memory/export              — GDPR export.
 *
 * Every route is gated by `isLangwatchStaff(email)` AND
 * `release_langy_enabled` (see the middleware below).
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
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
  LangyConversationService,
  LangyMessageService,
  LangyProjectMemoryService,
  LangyUserPreferencesService,
} from "~/server/services/langy";
import { checkLangyMessageRateLimit } from "~/server/middleware/rate-limit-langy";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:api:langy");

const LANGY_FALLBACK_MODEL = "openai/gpt-5-mini";

async function loadInjectableProjectMemory(
  projectId: string,
): Promise<string | null> {
  const service = LangyProjectMemoryService.create(prisma);
  const memory = await service.getById({ projectId });
  if (!memory) return null;
  return memory.contentSummary ?? memory.content;
}

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

export const app = new Hono().basePath("/api");
app.use(tracerMiddleware({ name: "langy" }));
app.use(loggerMiddleware());
app.use("/langy/*", async (c, next) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
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
  const session = await getServerAuthSession({ req: c.req.raw as any });
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
  if (!agentUrl) {
    logger.error("OPENCODE_AGENT_URL is not configured");
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

  const conversation = await conversationService.ensureConversation({
    projectId,
    userId: session.user.id,
    conversationId: requestedConversationId ?? null,
    title:
      messages[0] && extractAssistantText(messages[0].parts as any)
        ? extractAssistantText(messages[0].parts as any).slice(0, 80)
        : null,
  });

  const lastUserMessage = messages[messages.length - 1];
  const projectMemory = await loadInjectableProjectMemory(projectId);

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

  const userText = extractAssistantText(
    lastUserMessage?.parts as Array<Record<string, unknown>> | undefined,
  );

  // The pod's AGENTS.md is written for CLI/codebase instrumentation
  // (the OpenCode default), not in-product Langy. We need to override that
  // with a Langy-specific system block, but phrased to FIT the MCP tool
  // catalog the pod actually has (search_traces, get_analytics,
  // list_evaluators, etc.) — NOT the legacy Vercel-AI-SDK propose_* flow.
  // Without this, the agent answers like a generic repo assistant
  // ("what should I do in this repository?").
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
  const memoryPreamble = projectMemory
    ? `\n\nProject memory:\n${projectMemory}`
    : "";
  const fullPrompt = `${langyOverride}${memoryPreamble}\n\nUser: ${userText}`;

  const agentResponse = await fetch(`${agentUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: fullPrompt }),
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
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
              continue;
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
          } catch {}
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

async function requireProjectAdmin(session: Awaited<ReturnType<typeof getServerAuthSession>>, projectId: string) {
  if (!session) return false;
  return await hasProjectPermission(
    { prisma, session },
    projectId,
    "project:manage",
  );
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
// Project memory
// ============================================================================

const PROJECT_MEMORY_REFRESH_PROMPT = `You are regenerating a project memory file for the LangWatch assistant Langy.

Read the snapshot of the project state below (evaluators, prompts, datasets) and produce a concise, plain-language markdown brief covering:
- What this project does (one sentence)
- Active evaluators and what they check
- Notable prompts and their purpose
- Anything unusual worth noting

Keep under 1500 tokens. No invented facts.`;

app.get("/langy/project-memory", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const service = LangyProjectMemoryService.create(prisma);
  const memory = await service.getById({ projectId: projectId! });
  return c.json({ memory });
});

app.put("/langy/project-memory", async (c) => {
  const body = (await c.req.json()) as { projectId: string; content: string };
  const guard = await requireSessionAndPermission(c, body.projectId);
  if (guard.error) return guard.error;
  const isAdmin = await requireProjectAdmin(guard.session!, body.projectId);
  if (!isAdmin) {
    return c.json(
      { error: "Editing project memory requires project admin." },
      { status: 403 },
    );
  }
  const service = LangyProjectMemoryService.create(prisma);
  const memory = await service.writeNewVersion({
    projectId: body.projectId,
    content: body.content,
    changedById: guard.session!.user.id,
    changeReason: "user_edit",
  });
  await auditLog({
    userId: guard.session!.user.id,
    projectId: body.projectId,
    action: "langy.project_memory.edit",
    args: { contentVersion: memory.contentVersion },
  });
  return c.json({ memory });
});

app.post("/langy/project-memory/refresh", async (c) => {
  const body = (await c.req.json()) as { projectId: string };
  const guard = await requireSessionAndPermission(c, body.projectId);
  if (guard.error) return guard.error;
  const isAdmin = await requireProjectAdmin(guard.session!, body.projectId);
  if (!isAdmin) {
    return c.json(
      { error: "Refreshing project memory requires project admin." },
      { status: 403 },
    );
  }

  let model;
  try {
    model = await getVercelAIModel(body.projectId);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "No model configured.",
      },
      { status: 409 },
    );
  }

  const [project, evaluators, prompts, datasets] = await Promise.all([
    prisma.project.findUnique({
      where: { id: body.projectId },
      select: { name: true, language: true, framework: true },
    }),
    prisma.evaluator.findMany({
      where: { projectId: body.projectId },
      select: { name: true, slug: true, type: true },
      take: 50,
    }),
    prisma.llmPromptConfig.findMany({
      where: { projectId: body.projectId },
      select: { handle: true, name: true },
      take: 50,
    }),
    prisma.dataset.findMany({
      where: { projectId: body.projectId, archivedAt: null },
      select: { name: true, slug: true },
      take: 50,
    }),
  ]);

  const snapshot = JSON.stringify(
    { project, evaluators, prompts, datasets },
    null,
    2,
  );

  const stream = streamText({
    model,
    system: PROJECT_MEMORY_REFRESH_PROMPT,
    messages: [
      {
        role: "user",
        content: `Project snapshot (JSON):\n\n${snapshot}`,
      },
    ],
    onFinish: async ({ text }) => {
      try {
        const memoryService = LangyProjectMemoryService.create(prisma);
        await memoryService.writeNewVersion({
          projectId: body.projectId,
          content: text,
          changeReason: "user_refresh",
          changedById: guard.session!.user.id,
        });
        await auditLog({
          userId: guard.session!.user.id,
          projectId: body.projectId,
          action: "langy.project_memory.refresh",
        });
      } catch (error) {
        logger.error({ error }, "failed to persist refreshed project memory");
      }
    },
    onError: (error) => {
      logger.error({ error }, "project memory refresh stream errored");
    },
  });

  return stream.toUIMessageStreamResponse();
});

// ============================================================================
// Preferences
// ============================================================================

app.get("/langy/preferences", async (c) => {
  const projectId = c.req.query("projectId");
  const guard = await requireSessionAndPermission(c, projectId);
  if (guard.error) return guard.error;
  const service = LangyUserPreferencesService.create(prisma);
  const prefs = await service.getById({
    userId: guard.session!.user.id,
    projectId: projectId!,
  });
  return c.json({ preferences: prefs });
});

app.put("/langy/preferences", async (c) => {
  const body = (await c.req.json()) as {
    projectId: string;
    mode?: "non_expert" | "expert";
    dismissedSuggestionKinds?: string[];
  };
  const guard = await requireSessionAndPermission(c, body.projectId);
  if (guard.error) return guard.error;
  const service = LangyUserPreferencesService.create(prisma);
  let prefs = await service.getById({
    userId: guard.session!.user.id,
    projectId: body.projectId,
  });
  if (body.mode) {
    prefs = await service.setMode({
      userId: guard.session!.user.id,
      projectId: body.projectId,
      mode: body.mode,
    });
  }
  if (body.dismissedSuggestionKinds) {
    prefs = await service.setDismissedSuggestionKinds({
      userId: guard.session!.user.id,
      projectId: body.projectId,
      kinds: body.dismissedSuggestionKinds,
    });
  }
  return c.json({ preferences: prefs });
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
  const prefService = LangyUserPreferencesService.create(prisma);
  const result = await convService.clearAllForUser({
    projectId: projectId!,
    userId,
  });
  await prefService.resetForUser({ projectId: projectId!, userId });
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
  const prefService = LangyUserPreferencesService.create(prisma);
  const preferences = await prefService.getById({
    userId,
    projectId: projectId!,
  });
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
    preferences,
  });
});

