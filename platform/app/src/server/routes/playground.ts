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
import { env } from "~/env.mjs";
import { hasProjectPermission } from "~/server/api/rbac";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { nlpgoProxyBaseURL } from "~/server/nlpgo/nlpgoFetch";

const errorCache: Record<string, any> = {};

/** Resolves the `{mpId}/{model}` or legacy `{provider}/{model}` wire format
 *  to its configured model provider. Accepts either the canonical `{mpId}/
 *  {model}` format or the legacy `{provider}/{model}`. For mp-id values we
 *  look up the MP by id; for legacy values we resolve to the single
 *  accessible MP for that provider (today always narrowest-wins) exactly as
 *  before. */
function resolveModelProvider(
  modelProviders: Record<string, any>,
  model: string,
): { providerKey: string; modelProvider: any } {
  const providerKey = model.split("/")[0] as string;
  const modelProvider = providerKey.startsWith("mp_")
    ? (Object.values(modelProviders).find(
        (mp) => (mp as any).id === providerKey,
      ) as any)
    : modelProviders[providerKey];
  return { providerKey, modelProvider };
}

/** Builds the Vercel AI provider that proxies through nlpgo's in-process AI
 *  Gateway (Go playground proxy: `/go/proxy/v1/*`, no LiteLLM). Wire shape
 *  is x-litellm-* headers + OpenAI body, read by the gatewayproxy package
 *  and dispatched in-process. */
async function buildPlaygroundProvider({
  model,
  modelProvider,
  projectId,
}: {
  model: string;
  modelProvider: any;
  projectId: string;
}) {
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

  const baseURL = nlpgoProxyBaseURL({
    baseURL: env.LANGWATCH_NLP_SERVICE,
  });
  return createOpenAI({
    apiKey: litellmParams.api_key,
    baseURL,
    headers,
  });
}

/** Shapes a `streamText` failure into the wire response, caching a 401/403
 *  provider error under `cacheKey` so the next request short-circuits
 *  straight to it (see the `errorCache` read above). Rethrows anything else. */
function playgroundErrorResponse(c: any, e: any, cacheKey: string): Response {
  try {
    if (e.statusCode === 401 || e.statusCode === 403) {
      const error = JSON.parse(e.cause.value.responseBody);
      errorCache[cacheKey] = {
        error: error.error.message,
      };
      return c.json(error, { status: 401 });
    }
  } catch {
    /* safe json parse fallback */
  }
  throw e;
}

const secured = createServiceApp({ basePath: "/api" });

secured
  .access(
    handlerManagedAuth({
      reason: "user session validated in-handler via getServerAuthSession",
      permissions: ["playground:manage"],
      credential: "session",
    }),
  )
  .post("/playground", async (c) => {
    const session = await getServerAuthSession({ req: c.req.raw as any });
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

    const modelProviders = await getProjectModelProviders(projectId);
    const { providerKey, modelProvider } = resolveModelProvider(
      modelProviders as Record<string, any>,
      model,
    );
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

    const vercelProvider = await buildPlaygroundProvider({
      model,
      modelProvider,
      projectId,
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
      return playgroundErrorResponse(c, e, `${projectId}_${model}`);
    }
  });

export const app = secured.hono;
