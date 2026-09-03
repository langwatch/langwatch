/**
 * `POST /api/playground` — the model playground's streaming proxy.
 *
 * A `handlerManagedAuth({ credential: "session" })` family: it resolves the
 * signed-in person itself and answers a bare `{ error }` at 401, 400 and 403.
 * The session arrives as a port for that reason.
 *
 * The playground is the one surface that dispatches a model the CALLER named
 * rather than one a feature key resolved, which is why it resolves the
 * provider itself instead of going through the execution handle: the wire
 * accepts both the canonical `{mpId}/{model}` spelling and the legacy
 * `{provider}/{model}` one, and it must tell a provider that is not configured
 * apart from one that is configured and switched off — two different sentences
 * a customer acts on differently.
 *
 * ## The one-shot credential-error cache
 *
 * A 401/403 from the upstream provider is remembered per project+model and
 * replayed ONCE on the next request, then dropped. It is transcribed as it
 * was: the streaming response has already begun by the time the provider
 * refuses, so the refusal cannot be turned into a status code on the request
 * that caused it, and the next request is the only place the customer can be
 * shown what happened. Process-local and unbounded in principle, bounded in
 * practice by one entry per project+model that has failed.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { streamText } from "ai";

import { getProjectModelProviders } from "../../adapters/legacy-model-provider.adapter";

/** The signed-in person this door reads. */
export type PlaygroundRestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** What the playground reaches that it does not own. */
export interface PlaygroundRestPorts<TSession extends PlaygroundRestSession> {
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds `playground:manage` on the project. */
  probeProjectPermission(
    session: TSession,
    projectId: string,
    permission: "playground:manage",
  ): Promise<boolean>;
  /** The gateway every provider row and prepared credential is read from. */
  modelProviders(): ModelProviderService;
  /** Where the execution proxy answers, fully formed: nlpgo's `/go/proxy/v1`. */
  executionProxyBaseUrl: string;
}

/** `/api/playground`, bound to one process. */
export function createPlaygroundRestApp<TSession extends PlaygroundRestSession>(options: {
  security: AppRestSecurity;
  ports: PlaygroundRestPorts<TSession>;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

  /** One replayable upstream credential refusal per project+model. */
  const errorCache = new Map<string, { error: string }>();

  secured
    .access(
      handlerManagedAuth({
        reason: "user session validated in-handler via the process's session resolver",
        permissions: ["playground:manage"],
        credential: "session",
      }),
    )
    .post("/playground", async (c) => {
      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        return c.json({ error: "You must be logged in to access this endpoint." }, 401);
      }

      const projectId = c.req.header("x-project-id");
      if (!projectId) {
        return c.json({ error: "Missing projectId header" }, 400);
      }

      if (!(await ports.probeProjectPermission(session, projectId, "playground:manage"))) {
        return c.json({ error: "You do not have permission to access this endpoint." }, 403);
      }

      const { messages } = await c.req.json();

      const model = c.req.header("x-model");
      if (!model) {
        return c.json({ error: "Missing model header" }, 400);
      }

      const service = ports.modelProviders();

      // Either the canonical `{mpId}/{model}` wire format or the legacy
      // `{provider}/{model}`. An mp-id is looked up by id; a legacy value
      // resolves to the single accessible provider for that key.
      const modelProviders = await getProjectModelProviders(service, projectId);
      const providerKey = model.split("/")[0] ?? "";
      const modelProvider = providerKey.startsWith("mp_")
        ? Object.values(modelProviders).find((provider) => provider.id === providerKey)
        : modelProviders[providerKey];
      if (!modelProvider) {
        return c.json({ error: `Provider not configured: ${providerKey}` }, 400);
      }

      if (!modelProvider.enabled) {
        return c.json(
          { error: `Provider ${providerKey} is disabled, go to settings to enable it` },
          400,
        );
      }

      const cacheKey = `${projectId}_${model}`;
      const previousError = errorCache.get(cacheKey);
      if (previousError) {
        errorCache.delete(cacheKey);
        return c.json(previousError, 401);
      }

      const litellmParams = await service.prepareExecution({ model, projectId });
      const headers = Object.fromEntries(
        Object.entries(litellmParams).map(([key, value]) => [`x-litellm-${key}`, value]),
      );

      const vercelProvider = createOpenAI({
        apiKey: litellmParams.api_key,
        baseURL: ports.executionProxyBaseUrl,
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

        const response = result.toTextStreamResponse();
        return new Response(response.body, {
          status: response.status,
          headers: response.headers,
        });
      } catch (error: any) {
        try {
          if (error.statusCode === 401 || error.statusCode === 403) {
            const parsed = JSON.parse(error.cause.value.responseBody);
            errorCache.set(cacheKey, { error: parsed.error.message });
            return c.json(parsed, 401);
          }
        } catch {
          /* safe json parse fallback */
        }
        throw error;
      }
    });

  return secured.hono;
}
