/**
 * `POST /api/playground` — the model playground's streaming proxy. The door
 * resolves nobody: the project is named in a header, so the signed-in person
 * and their standing on it arrive as one bound fact, and the route answers its
 * own 401 and 403 from that fact in the sentences it has always used.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  jsonResponse,
  MANAGEMENT_API_VERSION,
  type RestRawResult,
} from "@langwatch/api/rest";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { streamText } from "ai";
import { z } from "zod";

import { getProjectModelProviders } from "../rules/legacy-model-provider.rules.ts";

/**
 * Who is asking, and whether they hold `playground:manage` on the project the
 * `x-project-id` header names. Anonymous when there is no session, and
 * `permitted: false` when the header named no project the caller may drive.
 */
export const playgroundRestCaller = defineRestMiddleware(
  "playgroundRestCaller",
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("anonymous") }),
    z.object({ kind: z.literal("signedIn"), userId: z.string(), permitted: z.boolean() }),
  ]),
);

/** The model, the project and the system prompt all travel as headers. */
export const playgroundRestModel = defineRestMiddleware(
  "playgroundRestModel",
  z.string().nullable(),
);
export const playgroundRestProject = defineRestMiddleware(
  "playgroundRestProject",
  z.string().nullable(),
);
export const playgroundRestSystemPrompt = defineRestMiddleware(
  "playgroundRestSystemPrompt",
  z.string().nullable(),
);

/**
 * Where the execution proxy answers, fully formed: nlpgo's `/go/proxy/v1`.
 * A fact rather than a constant, because only the process knows the address
 * the rest of its model dispatch resolves through.
 */
export const playgroundRestExecutionProxy = defineRestMiddleware(
  "playgroundRestExecutionProxy",
  z.string(),
);

/**
 * One replayable upstream credential refusal per project and model. Module
 * scope because the declaration is inert and a process runs exactly one of it.
 */
const errorCache = new Map<string, { error: string }>();

/** The conversation, as the browser's chat transport posts it. */
const playgroundBodySchema = z.object({ messages: z.array(z.unknown()) });

const SESSION_RESOLVED_BY_THE_ROUTE =
  "the browser session behind this request, and the caller's standing on the project the " +
  "x-project-id header names, are resolved by the mount and read as a fact; no API credential " +
  "opens this door";

export const playgroundRest = defineRestRouter(ModelProviderApi)
  .withNamespace("playground")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/playground", "runPlaygroundCompletion")
  .withInput(playgroundBodySchema)
  .withAccess(publicRoute({ reason: SESSION_RESOLVED_BY_THE_ROUTE }))
  .withMiddleware(
    playgroundRestCaller,
    playgroundRestProject,
    playgroundRestModel,
    playgroundRestSystemPrompt,
    playgroundRestExecutionProxy,
  )
  .withRawResponse({ produces: "text/plain" })
  .handle(async ({ app, input }, caller, projectId, model, systemPrompt, executionProxyBaseUrl) => {
    if (caller.kind === "anonymous") {
      return jsonResponse({ error: "You must be logged in to access this endpoint." }, 401);
    }

    if (!projectId) return jsonResponse({ error: "Missing projectId header" }, 400);

    if (!caller.permitted) {
      return jsonResponse({ error: "You do not have permission to access this endpoint." }, 403);
    }

    if (!model) return jsonResponse({ error: "Missing model header" }, 400);

    const chosen = await chooseProvider({ app, projectId, model });

    if ("refusal" in chosen) return chosen.refusal;

    const cacheKey = `${projectId}_${model}`;
    const previousError = errorCache.get(cacheKey);

    if (previousError) {
      errorCache.delete(cacheKey);

      return jsonResponse(previousError, 401);
    }

    return stream({
      app,
      projectId,
      model,
      systemPrompt,
      executionProxyBaseUrl,
      cacheKey,
      hasCustomKeys: Boolean(chosen.provider.customKeys),
      messages: input.messages,
    });
  })
  .build();

/** One row of the execution listing, reduced to what this door reads. */
type PlaygroundProvider = Readonly<{
  id: string;
  enabled: boolean;
  customKeys: Record<string, unknown> | null;
}>;

/**
 * Either the canonical `{mpId}/{model}` wire format or the legacy
 * `{provider}/{model}`. An mp-id is looked up by id; a legacy value resolves
 * to the single accessible provider for that key.
 */
async function chooseProvider({
  app,
  projectId,
  model,
}: {
  app: ModelProviderApi;
  projectId: string;
  model: string;
}): Promise<{ provider: PlaygroundProvider } | { refusal: Response }> {
  const providers = await getProjectModelProviders(app, projectId);
  const providerKey = model.split("/")[0] ?? "";
  const provider = providerKey.startsWith("mp_")
    ? Object.values(providers).find((candidate) => candidate.id === providerKey)
    : providers[providerKey];

  if (!provider) {
    return { refusal: jsonResponse({ error: `Provider not configured: ${providerKey}` }, 400) };
  }

  if (!provider.enabled) {
    return {
      refusal: jsonResponse(
        { error: `Provider ${providerKey} is disabled, go to settings to enable it` },
        400,
      ),
    };
  }

  return { provider };
}

/**
 * The completion, streamed through the same execution proxy every other model
 * dispatch on this process resolves through.
 */
async function stream({
  app,
  projectId,
  model,
  systemPrompt,
  executionProxyBaseUrl,
  cacheKey,
  hasCustomKeys,
  messages,
}: {
  app: ModelProviderApi;
  projectId: string;
  model: string;
  systemPrompt: string | null;
  executionProxyBaseUrl: string;
  cacheKey: string;
  hasCustomKeys: boolean;
  messages: readonly unknown[];
}): Promise<RestRawResult> {
  const litellmParams = await app.prepareExecution({ model, projectId });
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [`x-litellm-${key}`, value]),
  );

  const vercelProvider = createOpenAI({
    apiKey: litellmParams.api_key,
    baseURL: executionProxyBaseUrl,
    headers,
  });

  try {
    const result = streamText({
      model: vercelProvider(model),
      system: systemPrompt?.trim() ? systemPrompt : undefined,
      messages: messages as Parameters<typeof streamText>[0]["messages"],
      maxRetries: hasCustomKeys ? 1 : 3,
    });
    const response = result.toTextStreamResponse();

    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    const refusal = upstreamCredentialRefusal(error);

    if (!refusal) throw error;

    errorCache.set(cacheKey, { error: refusal.error.message });

    return jsonResponse(refusal, 401);
  }
}

/**
 * The provider's own 401 or 403 body, when it sent one. Anything else is not
 * a credential refusal and must keep bubbling.
 */
function upstreamCredentialRefusal(error: unknown): { error: { message: string } } | null {
  const failure = error as { statusCode?: number; cause?: { value?: { responseBody?: string } } };

  if (failure?.statusCode !== 401 && failure?.statusCode !== 403) return null;

  try {
    const parsed: unknown = JSON.parse(failure.cause?.value?.responseBody ?? "");
    const message = (parsed as { error?: { message?: unknown } })?.error?.message;

    return typeof message === "string" ? { error: { message } } : null;
  } catch {
    return null;
  }
}
