import { createOpenAI } from "@ai-sdk/openai";
import type {
  ModelProviderApi,
  ModelProviderPlaygroundCompletion,
  ModelProviderPlaygroundRequest,
  ModelProviderPlaygroundStatus,
} from "@langwatch/model-provider-contract";
import { streamText, type ModelMessage } from "ai";

import { getProjectModelProviders } from "../rules/legacy-model-provider.rules.ts";

type PlaygroundProvider = Readonly<{
  id: string;
  enabled: boolean;
  customKeys: Record<string, unknown> | null;
}>;

/** Owns provider selection, streaming and the one replayable credential refusal cache. */
export class ModelProviderPlaygroundService {
  #credentialRefusals = new Map<string, { error: string }>();
  readonly #modelProviders: ModelProviderApi;
  readonly #executionProxyBaseUrl: string;

  private constructor(modelProviders: ModelProviderApi, executionProxyBaseUrl: string) {
    this.#modelProviders = modelProviders;
    this.#executionProxyBaseUrl = executionProxyBaseUrl;
  }

  static create(options: {
    modelProviders: ModelProviderApi;
    executionProxyBaseUrl: string;
  }): ModelProviderPlaygroundService {
    return new ModelProviderPlaygroundService(
      options.modelProviders,
      options.executionProxyBaseUrl,
    );
  }

  async execute(input: ModelProviderPlaygroundRequest): Promise<ModelProviderPlaygroundCompletion> {
    const chosen = await this.#chooseProvider(input);
    if ("refusal" in chosen) return chosen.refusal;

    const cacheKey = `${input.projectId}_${input.model}`;
    const previousError = this.#credentialRefusals.get(cacheKey);
    if (previousError) {
      this.#credentialRefusals.delete(cacheKey);

      return jsonCompletion(previousError, 401);
    }

    const litellmParams = await this.#modelProviders.prepareExecution({
      model: input.model,
      projectId: input.projectId,
    });
    const headers = Object.fromEntries(
      Object.entries(litellmParams).map(([key, value]) => [`x-litellm-${key}`, value]),
    );
    const vercelProvider = createOpenAI({
      apiKey: litellmParams.api_key,
      baseURL: this.#executionProxyBaseUrl,
      headers,
    });

    try {
      const result = streamText({
        model: vercelProvider(input.model),
        system: input.systemPrompt?.trim() ? input.systemPrompt : undefined,
        messages: input.messages as ModelMessage[],
        maxRetries: chosen.provider.customKeys ? 1 : 3,
      });
      const response = result.toTextStreamResponse();

      return {
        status: 200,
        mediaType: "text/plain",
        headers: Object.fromEntries(response.headers.entries()),
        body: readableStreamChunks(response.body),
      };
    } catch (error) {
      const refusal = extractUpstreamCredentialRefusal(error);
      if (!refusal) throw error;

      this.#credentialRefusals.set(cacheKey, { error: refusal.error.message });

      return jsonCompletion(refusal, 401);
    }
  }

  async #chooseProvider(
    input: Pick<ModelProviderPlaygroundRequest, "projectId" | "model">,
  ): Promise<{ provider: PlaygroundProvider } | { refusal: ModelProviderPlaygroundCompletion }> {
    const providers = await getProjectModelProviders(this.#modelProviders, input.projectId);
    const providerKey = input.model.split("/")[0] ?? "";
    const provider = providerKey.startsWith("mp_")
      ? Object.values(providers).find((candidate) => candidate.id === providerKey)
      : providers[providerKey];

    if (!provider) {
      return {
        refusal: jsonCompletion({ error: `Provider not configured: ${providerKey}` }, 400),
      };
    }

    if (!provider.enabled) {
      return {
        refusal: jsonCompletion(
          { error: `Provider ${providerKey} is disabled, go to settings to enable it` },
          400,
        ),
      };
    }

    return { provider };
  }
}

function extractUpstreamCredentialRefusal(error: unknown): { error: { message: string } } | null {
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

function jsonCompletion(
  body: unknown,
  status: ModelProviderPlaygroundStatus,
): ModelProviderPlaygroundCompletion {
  const encoded = new TextEncoder().encode(JSON.stringify(body));

  return {
    status,
    mediaType: "application/json",
    headers: { "content-type": "application/json" },
    body: (async function* () {
      yield encoded;
    })(),
  };
}

async function* readableStreamChunks(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>> | null,
): AsyncGenerator<Uint8Array> {
  if (!stream) return;

  const reader = stream.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;

      yield chunk.value;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
