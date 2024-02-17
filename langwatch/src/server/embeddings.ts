import { OpenAI } from "openai";
import {
  OpenAIClient as AzureOpenAIClient,
  AzureKeyCredential,
} from "@azure/openai";
import { env } from "../env.mjs";

export const getOpenAIEmbeddings = async (text: string) => {
  // Temporary until text-embedding-3-small is also available on azure: https://learn.microsoft.com/en-us/answers/questions/1531681/openai-new-embeddings-model
  const useAzure = false;
  const model = "text-embedding-3-small";

  if (useAzure && env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_KEY) {
    const openai = new AzureOpenAIClient(
      env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(env.AZURE_OPENAI_KEY)
    );

    const response = await openai.getEmbeddings(model, [text]);
    const embeddings = response.data[0]?.embedding;
    return embeddings ? { model, embeddings } : undefined;
  } else {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    const response = await openai.embeddings.create({
      model: model,
      input: text,
    });
    const embeddings = response.data[0]?.embedding;
    return embeddings ? { model, embeddings } : undefined;
  }
};
