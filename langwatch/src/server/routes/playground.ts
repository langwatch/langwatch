/**
 * Hono route for the playground endpoint.
 *
 * Replaces POST /api/playground
 *
 * Proxies LLM requests through litellm, streaming the response
 * back to the client as text.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Hono } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { env } from "~/env.mjs";
import { hasProjectPermission } from "~/server/api/rbac";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import type { NextRequest } from "next/server";

const errorCache: Record<string, any> = {};

export const app = new Hono().basePath("/api");
app.use(tracerMiddleware({ name: "playground" }));
app.use(loggerMiddleware());

app.post("/playground", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as NextRequest });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const projectId = c.req.header("x-project-id");
  if (!projectId) {
    return c.json({ error: "Missing projectId header" }, { status: 400 });
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "playground:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  const { messages } = await c.req.json();

  const model = c.req.header("x-model");
  if (!model) {
    return c.json({ error: "Missing model header" }, { status: 400 });
  }

  const providerKey = model.split("/")[0] as string;
  const modelProviders = await getProjectModelProviders(projectId);
  const modelProvider = (modelProviders as Record<string, any>)[providerKey];
  if (!modelProvider) {
    return c.json(
      { error: `Provider not configured: ${providerKey}` },
      { status: 400 },
    );
  }

  if (!modelProvider.enabled) {
    return c.json(
      {
        error: `Provider ${providerKey} is disabled, go to settings to enable it`,
      },
      { status: 400 },
    );
  }

  const previousError = errorCache[`${projectId}_${model}`];
  if (previousError) {
    delete errorCache[`${projectId}_${model}`];
    return c.json(previousError, { status: 401 });
  }

  const litellmParams = await prepareLitellmParams({
    model,
    modelProvider,
    projectId,
  });
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ]),
  );

  const vercelProvider = createOpenAI({
    apiKey: litellmParams.api_key,
    baseURL: `${env.LANGWATCH_NLP_SERVICE}/proxy/v1`,
    headers,
  });

  const systemPrompt = c.req.header("x-system-prompt");
  try {
    const result = streamText({
      model: vercelProvider(model),
      system: systemPrompt?.trim() ? systemPrompt : undefined,
      messages,
      maxRetries: modelProvider.customKeys ? 1 : 3,
    });

    // Return the text stream response (Vercel AI SDK produces a ReadableStream)
    const response = result.toTextStreamResponse();
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (e: any) {
    try {
      if (e.statusCode === 401 || e.statusCode === 403) {
        const error = JSON.parse(e.cause.value.responseBody);
        errorCache[`${projectId}_${model}`] = {
          error: error.error.message,
        };
        return c.json(error, { status: 401 });
      }
    } catch {
      /* safe json parse fallback */
    }
    throw e;
  }
});
