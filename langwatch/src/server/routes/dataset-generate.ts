/**
 * Hono route for AI-powered dataset generation.
 *
 * Replaces POST /api/dataset/generate
 *
 * Uses the Vercel AI SDK to stream tool-assisted dataset row generation
 * back to the client.
 */
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  smoothStream,
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
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { createLogger } from "~/utils/logger/server";
import { tools } from "~/app/api/dataset/generate/tools";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:api:dataset:generate");

export const app = new Hono().basePath("/api/dataset");
app.use(tracerMiddleware({ name: "dataset-generate" }));
app.use(loggerMiddleware());

app.post("/generate", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const { messages, dataset, projectId } = (await c.req.json()) as {
    messages: UIMessage[];
    dataset: string;
    projectId: string;
  };

  if (!projectId) {
    return c.json({ error: "Missing projectId header" }, { status: 400 });
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "datasets:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  // Add system prompts
  messages.unshift({
    role: "system",
    parts: [
      {
        type: "text",
        text: `
You are a dataset generation assistant. You will be given a dataset, user instructions and a set of tools to use for adding, updating and deleting rows.

IMPORTANT: When the user asks you to add N rows (e.g., "add 10 examples"), you MUST call the addRow tool exactly N times - once for each row you're creating. Each addRow call adds ONE single row to the dataset.

If the user asks for more than 30 rows, generate only 30 rows and tell them you can only generate 30 rows at a time (it can go over 30 rows if the user asks for more on subsequent messages).
Keep calling the tools in sequence as many times as you need to to generate the dataset.
Keep the examples short and concise.

Current dataset:

${dataset}`,
      },
    ],
  } as UIMessage);

  const model = await getVercelAIModel(projectId);
  const result = streamText({
    model,
    messages: await convertToModelMessages(messages),
    tools: tools(dataset),
    toolChoice: "required",
    maxOutputTokens: 4096 * 4,
    stopWhen: stepCountIs(50),
    experimental_transform: smoothStream({ chunking: "word" }),
    maxRetries: 3,
    onError: (error) => {
      logger.error({ error }, "error in streamtext");
    },
    providerOptions: {
      openai: {
        reasoningEffort: "low",
      } satisfies OpenAIResponsesProviderOptions,
    },
  });

  const response = result.toUIMessageStreamResponse();
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});
