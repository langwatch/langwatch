import { OpenAI } from "openai";
import {
  OpenAIClient as AzureOpenAIClient,
  AzureKeyCredential,
} from "@azure/openai";
import { env } from "../env.mjs";

export const DEFAULT_EMBEDDINGS_MODEL = "text-embedding-3-small";

export const getOpenAIEmbeddings = async (text: string) => {
  // Temporary until text-embedding-3-small is also available on azure: https://learn.microsoft.com/en-us/answers/questions/1531681/openai-new-embeddings-model
  const useAzure = false;
  const model = DEFAULT_EMBEDDINGS_MODEL;

  if (useAzure && env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_KEY) {
    if (!env.AZURE_OPENAI_KEY) {
      console.warn(
        "⚠️  WARNING: AZURE_OPENAI_KEY is not set, embeddings will not be generated for tracing, limiting semantic search and topic clustering. Please set AZURE_OPENAI_KEY for it to work properly"
      );
      return undefined;
    }
    const openai = new AzureOpenAIClient(
      env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(env.AZURE_OPENAI_KEY)
    );

    const response = await openai.getEmbeddings(model, [
      text.slice(0, 8192 * 4),
    ]);
    const embeddings = response.data[0]?.embedding;
    return embeddings ? { model, embeddings } : undefined;
  } else {
    if (!env.OPENAI_API_KEY) {
      console.warn(
        "⚠️  WARNING: OPENAI_API_KEY is not set, embeddings will not be generated for tracing, limiting semantic search and topic clustering. Please set OPENAI_API_KEY for it to work properly"
      );
      return undefined;
    }
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    const response = await openai.embeddings.create({
      model: model,
      input: text.slice(0, 8192 * 1.5),
    });
    const embeddings = response.data[0]?.embedding;
    return embeddings ? { model, embeddings } : undefined;
  }
};
