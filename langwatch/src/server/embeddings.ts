import { OpenAI } from "openai";
import { env } from "../env.mjs";

export const getOpenAIEmbeddings = async (text: string) => {
  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });
  return response.data[0]?.embedding;
};
