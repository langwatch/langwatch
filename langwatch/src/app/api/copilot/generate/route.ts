import { backendHasTeamProjectPermission } from "../../../../server/api/permission";

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../server/db";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../server/auth";
import { getVercelAIModel } from "../../../../server/modelProviders/utils";
import { smoothStream, streamText } from "ai";
import { tools } from "./tools.shared";

import { createLogger } from "../../../../utils/logger";

const logger = createLogger("langwatch:api:copilot:generate");

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions(req));
  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const { messages, currentCode, projectId } = await req.json();
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing projectId header" },
      { status: 400 },
    );
  }
  const hasPermission = await backendHasTeamProjectPermission(
    { prisma, session },
    { projectId },
    "COPILOT"
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
    content: `
You are an assistant that helps users generate code to generate datasets and write code to test those datasets.
You will be given a \`generateCode\` tool, always use that when you want to generate code, otherwise just answer the user in text if you just want to answer a question.

# Evaluators

## LLM-as-a-Judge

**Name:** \`llm-as-a-judge\`
**Params:** \`{ "prompt": str }\`
**Desc:** This tool uses a large language model to evaluate whether a given dataset is good or bad. It uses a \`prompt\` to evaluate an \`input\` and \`output\` pair, and decide if the output is correct.

# Dataset Generation Rules

Datasets are CSV files, with the following columns:

- \`id\`: A random unique identifier for the row.
- \`input\`: The input to the model.
- \`output\`: The output of the model.

# Code Generation

- This must be written in Python.
- Do not repeat the code to the user, it must only be send via a tool call, or there will be consequences.
- If the user asks for transformations to be made, don't do them in the dataset, do them in the \`evaluate_row\` function

The output must match the following format, in markdown:

\`\`\`python
from typing import Dict, Any
import langwatch

dataset: Dict[str, Any] = [{
	"id": str,
	"input": str,
	"output": str,
}]

def evaluate_row(id: str, input: str, output: str) -> bool:
	result = langwatch.evaluate(
		evaluator_name="<evaluator-name>",
		evaluator_params={<evaluator-params>},
		input=input,
		output=output,
	)
	
	langwatch.add_evaluation(
		id=id,
		params={{
			"evaluator_name": "<evaluator-name>",
			"evaluator_params": <evaluator-params>,
			"input": input,
			"output": output,
			"result": result,
		}}
	)

if __name__ == "__main__":
	for row in dataset:
		evaluate_row(row["id"], row["input"], row["output"])
\`\`\`
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
