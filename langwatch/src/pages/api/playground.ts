import { createOpenAI } from "@ai-sdk/openai";
import { StreamingTextResponse, streamText } from "ai";
import type { NextApiResponse } from "next";
import { env } from "../../env.mjs";

export const runtime = "edge";

export default async function handler(req: Request, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const { messages } = await req.json();

  const openai = createOpenAI({
    baseURL: `${env.LANGWATCH_NLP_SERVICE}/proxy/v1`,
  });

  const model = req.headers.get("x-model");
  if (!model) {
    return res.status(400).json({ error: "Missing model header" });
  }

  const result = await streamText({
    model: openai(model),
    messages,
  });

  return new StreamingTextResponse(result.toAIStream());
}
