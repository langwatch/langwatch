import { backendHasTeamProjectPermission } from "../../../../server/api/permission";

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../server/db";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../server/auth";
import { getVercelAIModel } from "../../../../server/modelProviders/utils";
import { smoothStream, streamText } from "ai";
import { tools } from "./tools";

import { createLogger } from "../../../../utils/logger";

const logger = createLogger("langwatch:api:dataset:generate");

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions(req));
  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 }
    );
  }

  const { messages, dataset, projectId } = await req.json();

  if (!projectId) {
    return NextResponse.json(
      { error: "Missing projectId header" },
      { status: 400 }
    );
  }

  const hasPermission = await backendHasTeamProjectPermission(
    { prisma, session },
    { projectId },
    "DATASETS_MANAGE"
  );
  if (!hasPermission) {
    return NextResponse.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 }
    );
  }

  // , also a tool for changing columns in the dataset.

  // Add system prompts
  messages.unshift({
    role: "system",
    content: `
You are a dataset generation assistant. You will be given a dataset, user instructions and a set of tools to use \
for adding, updating and deleting rows.
If the user asks for more than 30 rows, generate only 30 rows and tell them you can only generate 30 rows at a time (it can go over 30 rows if the user asks for more on subsequent messages).
Keep calling the tools in sequence as many times as you need to to generate the dataset.
Keep your non-tool textual responses short and concise.
Only call 5 tools in parallel max.

Current dataset:

${JSON.stringify(dataset)}
    `,
  });

  const model = await getVercelAIModel(projectId, undefined, {
    parallelToolCalls: false,
  });

  const result = streamText({
    model,
    messages,
    maxTokens: 4096 * 2,
    maxSteps: 20,
    experimental_transform: smoothStream({ chunking: "word" }),
    experimental_continueSteps: true,
    toolCallStreaming: true,
    tools: tools,
    maxRetries: 3,
    onError: (error) => {
      logger.error({ error }, "error in streamtext");
    },
  });

  return result.toDataStreamResponse();
}
