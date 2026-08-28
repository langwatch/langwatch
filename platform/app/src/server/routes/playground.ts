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
import { getProjectModelProviders } from "~/server/api/routers/modelProviders.utils";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import { nlpgoProxyBaseURL } from "~/server/nlpgo/nlpgoFetch";

const errorCache: Record<string, any> = {};

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
    const session = await getServerAuthSession({ app: c.app, req: c.req.raw });
    if (!session) {
      return c.json({ error: "You must be logged in to access this endpoint." }, { status: 401 });
    }

    const projectId = c.req.header("x-project-id");
    if (!projectId) {
      return c.json({ error: "Missing projectId header" }, { status: 400 });
    }

    const hasPermission = await probeProjectPermission({ session }, projectId, "playground:manage");
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

    // Accept either the canonical `{mpId}/{model}` wire format or the
    // legacy `{provider}/{model}`. For mp-id values we look up the MP by
    // id; for legacy values we resolve to the single accessible MP for
    // that provider (today always narrowest-wins) exactly as before.
    const modelProviders = await getProjectModelProviders(c.app.modelProviders, projectId);
    const providerKey = model.split("/")[0] ?? "";
    const modelProvider = providerKey.startsWith("mp_")
      ? Object.values(modelProviders).find((provider) => provider.id === providerKey)
      : modelProviders[providerKey];
    if (!modelProvider) {
      return c.json({ error: `Provider not configured: ${providerKey}` }, { status: 400 });
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

    const litellmParams = await c.app.modelProviders.prepareExecution({
      model,
      projectId,
    });
    const headers = Object.fromEntries(
      Object.entries(litellmParams).map(([key, value]) => [`x-litellm-${key}`, value]),
    );

    // Go playground proxy: nlpgo's /go/proxy/v1/* (in-process AI Gateway,
    // no LiteLLM). Wire shape is x-litellm-* headers + OpenAI body, read by
    // the gatewayproxy package and dispatched in-process.
    const baseURL = nlpgoProxyBaseURL({
      baseURL: env.LANGWATCH_NLP_SERVICE,
    });
    const vercelProvider = createOpenAI({
      apiKey: litellmParams.api_key,
      baseURL,
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

export const app = secured.hono;
