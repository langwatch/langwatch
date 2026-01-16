import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  smoothStream,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { hasProjectPermission } from "../../../../server/api/rbac";
import { authOptions } from "../../../../server/auth";
import { prisma } from "../../../../server/db";
import { getVercelAIModel } from "../../../../server/modelProviders/utils";
import { createLogger } from "../../../../utils/logger";
import { tools } from "./tools";

const logger = createLogger("langwatch:api:dataset:generate");

interface Body {
  messages: UIMessage[];
  dataset: string;
  projectId: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions(req));
  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const { messages, dataset, projectId } = (await req.json()) as Body;

  if (!projectId) {
    return NextResponse.json(
      { error: "Missing projectId header" },
      { status: 400 },
    );
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "datasets:manage",
  );
  if (!hasPermission) {
    return NextResponse.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  // Add system prompts
  messages.unshift({
    role: "system",
    parts: [
      {
        type: "text",
        text: `
You are a dataset generation assistant. You will be given a dataset, user instructions and a set of tools to use for adding, updating and deleting rows.

IMPORTANT: When the user asks you to add N rows (e.g., "add 10 examples"), you MUST call the addRow tool exactly N times - once for each row you're creating. Each addRow call adds ONE single row to the dataset.

If the user asks for more than 30 rows, generate only 30 rows and tell them you can only generate 30 rows at a time (it can go over 30 rows if the user asks for more on subsequent messages).
Keep calling the tools in sequence as many times as you need to to generate the dataset.
Keep the examples short and concise.

Current dataset:

${dataset}`,
      },
    ],
  } as UIMessage);

  const model = await getVercelAIModel(projectId);
  const result = streamText({
    model,
    messages: convertToModelMessages(messages),
    tools: tools(dataset),
    toolChoice: "required",
    maxOutputTokens: 4096 * 4,
    stopWhen: stepCountIs(50),
    experimental_transform: smoothStream({ chunking: "word" }),
    maxRetries: 3,
    onError: (error) => {
      logger.error({ error }, "error in streamtext");
    },
    providerOptions: {
      openai: {
        reasoningEffort: "minimal",
      } satisfies OpenAIResponsesProviderOptions,
    },
  });

  return result.toUIMessageStreamResponse();
}
