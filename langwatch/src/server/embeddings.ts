import { OpenAI } from "openai";
import {
  OpenAIClient as AzureOpenAIClient,
  AzureKeyCredential,
} from "@azure/openai";
import { env } from "../env.mjs";

export const getOpenAIEmbeddings = async (text: string) => {
  if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_KEY) {
    const openai = new AzureOpenAIClient(
      env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(env.AZURE_OPENAI_KEY)
    );

    const response = await openai.getEmbeddings("text-embedding-ada-002", [
      text,
    ]);
    return response.data[0]?.embedding;
  } else {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text,
    });
    return response.data[0]?.embedding;
  }
};
