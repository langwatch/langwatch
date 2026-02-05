import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { generateText } from "ai";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { CompletionCopilot } from "monacopilot";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { hasProjectPermission } from "../../../../server/api/rbac";
import { authOptions } from "../../../../server/auth";
import { prisma } from "../../../../server/db";
import { getVercelAIModel } from "../../../../server/modelProviders/utils";
import { createLogger } from "../../../../utils/logger/server";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";

const _logger = createLogger("langwatch:code-completion");

const app = new Hono().basePath("/api/workflows");
app.use(tracerMiddleware({ name: "workflows-code-completion" }));
app.use(loggerMiddleware());

app.post("/code-completion", async (c) => {
  const body = await c.req.json();

  const session = await getServerSession(authOptions(c.req.raw as NextRequest));
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const { projectId } = c.req.query();
  if (!projectId) {
    return c.json({ error: "Project ID is required." }, { status: 400 });
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "workflows:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  const model = await getVercelAIModel(projectId);

  const copilot = new CompletionCopilot(undefined, {
    model: async (prompt) => {
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "system",
            content: prompt.context,
          },
          {
            role: "user",
            content: `${prompt.instruction}\n\n${prompt.fileContent}`,
          },
        ],
        maxOutputTokens: 64,
        temperature: 0,
        providerOptions: {
          openai: {
            reasoningEffort: "low",
          } satisfies OpenAIResponsesProviderOptions,
        },
      });

      return { text };
    },
  });
  const completion = await copilot.complete({ body });

  return c.json(completion);
});

export const POST = handle(app);
