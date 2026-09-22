/**
 * The AI SDK handle for one model on one provider row.
 *
 * Every OpenAI-compatible lane reaches its vendor the same way: the row's
 * credential becomes `x-litellm-*` headers and the call goes to nlpgo's
 * in-process gateway proxy. `getVercelAIModel` builds that after resolving
 * which model and which row a feature should use; a caller that already knows
 * both (a connection test naming one row) builds it here directly, so the two
 * paths cannot drift on how a credential reaches the wire.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "../../env.mjs";
import { prepareLitellmParams } from "../api/routers/modelProviders.utils";
import { nlpgoProxyBaseURL } from "../nlpgo/nlpgoFetch";
import type { MaybeStoredModelProvider } from "./registry";

export async function nlpgoModelHandle({
  model,
  modelProvider,
  projectId,
}: {
  model: string;
  modelProvider: MaybeStoredModelProvider;
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

  // Go playground proxy: nlpgo's /go/proxy/v1/* (in-process AI Gateway,
  // no LiteLLM). Wire shape is x-litellm-* headers + OpenAI body; the Go
  // side reads x-litellm-* via the gatewayproxy package and dispatches
  // in-process.
  const baseURL = nlpgoProxyBaseURL({ baseURL: env.LANGWATCH_NLP_SERVICE! });
  const vercelProvider = createOpenAICompatible({
    name: modelProvider.provider,
    apiKey: litellmParams.api_key,
    baseURL,
    headers,
  });

  return vercelProvider(model);
}
