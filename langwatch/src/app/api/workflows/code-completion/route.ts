import { generateText } from "ai";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { CompletionCopilot } from "monacopilot";
import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { backendHasTeamProjectPermission } from "../../../../server/api/permission";
import { authOptions } from "../../../../server/auth";
import { prisma } from "../../../../server/db";
import { getVercelAIModel } from "../../../../server/modelProviders/utils";
import { createLogger } from "../../../../utils/logger";
import { loggerMiddleware } from "../../middleware/logger";

const logger = createLogger("langwatch:code-completion");

const app = new Hono().basePath("/api/workflows");
app.use(loggerMiddleware());

app.post("/code-completion", async (c) => {
  const body = await c.req.json();

  const session = await getServerSession(authOptions(c.req.raw as NextRequest));
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 }
    );
  }

  const { projectId } = c.req.query();
  if (!projectId) {
    return c.json({ error: "Project ID is required." }, { status: 400 });
  }

  const hasPermission = await backendHasTeamProjectPermission(
    { prisma, session },
    { projectId },
    "WORKFLOWS_MANAGE"
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 }
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
        maxTokens: 64,
        temperature: 0,
      });

      return { text };
    },
  });
  const completion = await copilot.complete({ body });

  return c.json(completion);
});

export const POST = handle(app);
