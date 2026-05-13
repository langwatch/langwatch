/**
 * Hono route for the Langy assistant.
 *
 * POST /api/langy/chat — streams an AI chat response with access to
 * read-only evaluator tools scoped to the caller's project.
 *
 * v1 is read-only: Langy proposes actions, it does not run evaluators,
 * mutate experiments, or modify project state.
 */
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { DatasetService } from "~/server/datasets/dataset.service";
import { BatchEvaluationService } from "~/server/evaluations/batch-evaluation.service";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { PromptService } from "~/server/prompt-config/prompt.service";
import { createLogger } from "~/utils/logger/server";
import { TiktokenClient } from "~/server/app-layer/clients/tokenizer/tiktoken.client";
import { buildLangyTelemetrySettings } from "~/server/observability/langy-tracer";
import {
  LangyConversationService,
  type LangyMode,
  LangyMessageService,
  LangyProjectMemoryService,
  LangyUserPreferencesService,
} from "~/server/services/langy";
import {
  LANGY_EXPERT_MODE_SUFFIX,
  LANGY_NON_EXPERT_MODE_SUFFIX,
  LANGY_SYSTEM_PROMPT,
} from "~/server/services/langy/prompts";
import { ConversationToolIdSet } from "~/server/services/langy/toolIdValidator";
import { buildLangyTools } from "~/server/services/langy/tools";
import { streamLangyMastraResponse } from "~/server/services/langy/mastra-agent";
import { featureFlagService } from "~/server/featureFlag";
import {
  LANGY_TOOL_CALLS_PER_MESSAGE,
  checkLangyMessageRateLimit,
} from "~/server/middleware/rate-limit-langy";
import { registerLangyConversationRoutes } from "./langy.conversations";
import { registerLangyProjectMemoryRoutes } from "./langy.project-memory";
import { registerLangyPreferencesRoutes } from "./langy.preferences";
import { registerLangyPrivacyRoutes } from "./langy.privacy";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:api:langy");

const LANGY_FALLBACK_MODEL = "openai/gpt-5-mini";

function buildSystemPrompt(opts: {
  projectMemory: string | null;
  mode: LangyMode;
}): string {
  const segments = [LANGY_SYSTEM_PROMPT];
  if (opts.mode === "expert") {
    segments.push(LANGY_EXPERT_MODE_SUFFIX);
  } else {
    segments.push(LANGY_NON_EXPERT_MODE_SUFFIX);
  }
  if (opts.projectMemory) {
    segments.push(
      `\n## Project memory\n${opts.projectMemory}\n\nUse this memory as context. If something here is wrong, the user can edit it in Settings → Langy.`,
    );
  }
  return segments.join("\n");
}

async function loadInjectableProjectMemory(
  projectId: string,
): Promise<string | null> {
  const service = LangyProjectMemoryService.create(prisma);
  const memory = await service.getById({ projectId });
  if (!memory) return null;
  return memory.content;
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
    experimentSlug,
    conversationId: requestedConversationId,
  } = (await c.req.json()) as {
    messages: UIMessage[];
    projectId: string;
    experimentSlug?: string;
    conversationId?: string | null;
  };

  if (!projectId) {
    return c.json({ error: "Missing projectId" }, { status: 400 });
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
        error: {
          code: "rate_limited" as const,
          message: "Too many messages. Please slow down.",
          retryAfterSeconds: rl.retryAfterSeconds,
        },
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
  const preferencesService = LangyUserPreferencesService.create(prisma);

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
  const prefs = await preferencesService.getById({
    userId: session.user.id,
    projectId,
  });

  let model;
  try {
    model = await getVercelAIModel(projectId);
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

  const batchEvaluationService = BatchEvaluationService.create(prisma);
  const datasetService = DatasetService.create(prisma);
  const evaluatorService = EvaluatorService.create(prisma);
  const experimentService = ExperimentService.create(prisma);
  const projectService = new ProjectService(new PrismaProjectRepository(prisma));
  const promptService = new PromptService(prisma);
  const seenIds = new ConversationToolIdSet();

  const toolCtx = {
    projectId,
    experimentSlug,
    batchEvaluationService,
    datasetService,
    evaluatorService,
    experimentService,
    projectService,
    promptService,
    seenIds,
  };

  const tools = buildLangyTools(toolCtx);

  const systemPrompt = buildSystemPrompt({
    projectMemory,
    mode: prefs.mode as LangyMode,
  });
  const modelMessages = await convertToModelMessages(messages);

  // Phase 4 spike (PR-4.3): route a small slice of traffic through Mastra.
  // Default-off; flip via PostHog or FEATURE_FLAG_FORCE_ENABLE. The legacy
  // streamText path below stays the production default until PR-4.5 cutover.
  const useMastra = await featureFlagService.isEnabled(
    "release_ui_langy_mastra_enabled",
    session.user.id,
    false,
    { projectId },
  );
  if (useMastra) {
    logger.info(
      { projectId, userId: session.user.id, conversationId: conversation.id },
      "langy.chat: serving via Mastra path",
    );
    const mastraResponse = await streamLangyMastraResponse({
      ctx: toolCtx,
      model,
      systemPrompt,
      messages: modelMessages,
      maxSteps: LANGY_TOOL_CALLS_PER_MESSAGE,
      // Assistant-message persistence + telemetry stay on the legacy path
      // until PR-4.4 (memory adapter). The spike's job is SSE parity.
    });
    const headers = new Headers(mastraResponse.headers);
    headers.set("x-langy-conversation-id", conversation.id);
    return new Response(mastraResponse.body, {
      status: mastraResponse.status,
      headers,
    });
  }

  const result = streamText({
    model,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(LANGY_TOOL_CALLS_PER_MESSAGE),
    maxRetries: 2,
    experimental_telemetry: buildLangyTelemetrySettings({
      userProjectId: projectId,
      userId: session.user.id,
      conversationId: conversation.id,
      mode: prefs.mode,
    }),
    onError: (error) => {
      logger.error({ error }, "error in langy chat stream");
    },
    onFinish: async ({ text, response }) => {
      try {
        const assistantMessages = response.messages.filter(
          (m) => m.role === "assistant" || m.role === "tool",
        );
        // Return type is annotated as `unknown[]` because the AI SDK content
        // union (text/file/image/tool-call/…) doesn't unify with the literal
        // text-shape we synthesise from string content. persistAssistantMessage
        // takes `parts: unknown`, so we lose nothing by widening here.
        const parts = assistantMessages.flatMap((m): unknown[] => {
          if (typeof m.content === "string") {
            return m.content
              ? [{ type: "text", text: m.content, role: m.role }]
              : [];
          }
          if (Array.isArray(m.content)) {
            return m.content.map((c) => ({ ...c, role: m.role }));
          }
          return [];
        });
        await persistAssistantMessage({
          conversationId: conversation.id,
          projectId,
          parts,
          text,
          model: LANGY_FALLBACK_MODEL,
        });
      } catch (error) {
        logger.error({ error }, "failed to persist langy assistant message");
      }
    },
  });

  const response = result.toUIMessageStreamResponse();
  const headers = new Headers(response.headers);
  headers.set("x-langy-conversation-id", conversation.id);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
});

// Conversation CRUD, project-memory CRUD, preferences, and privacy
// (clear-all + export) live in sibling files. Each register function
// mutates this same `app`, so middleware applied above (tracer, logger)
// covers every route uniformly.
registerLangyConversationRoutes(app);
registerLangyProjectMemoryRoutes(app);
registerLangyPreferencesRoutes(app);
registerLangyPrivacyRoutes(app);

