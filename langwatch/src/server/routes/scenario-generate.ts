/**
 * Hono route for AI-powered scenario generation.
 *
 * Replaces POST /api/scenario/generate
 *
 * Uses the Vercel AI SDK to generate a structured scenario object
 * (name, situation, criteria) from a user prompt.
 */
import { generateObject } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { createLogger } from "~/utils/logger/server";
import type { NextRequest } from "next/server";

const logger = createLogger("langwatch:api:scenario:generate");

const scenarioSchema = z.object({
  name: z
    .string()
    .describe("A short, descriptive name for the scenario (3-6 words)"),
  situation: z
    .string()
    .describe(
      "The context and setup: user persona, emotional state, background, and what they're trying to accomplish",
    ),
  criteria: z
    .array(z.string())
    .describe(
      "3-6 specific, observable success criteria that can be judged from the conversation",
    ),
});

const requestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  currentScenario: z
    .object({
      name: z.string(),
      situation: z.string(),
      criteria: z.array(z.string()),
    })
    .nullable(),
  projectId: z.string().min(1, "Project ID is required"),
});

const SYSTEM_PROMPT = `You are a scenario generation assistant for LangWatch. Your job is to help users create behavioral test scenarios for their AI agents. You will respond with a JSON object containing the scenario details.

Given a description of an agent and desired scenario, generate:

1. **name**: A clear, concise name (3-6 words, e.g., "Angry refund request")

2. **situation**: A detailed context formatted with clear sections separated by blank lines:
   - User persona (who they are)
   - Emotional state (frustrated, confused, rushed, etc.)
   - Background context (what happened before)
   - What they're trying to accomplish

   Format the situation with labeled sections on separate lines, like:
   "User persona: [description]

   Emotional state: [description]

   Background: [description]

   Goal: [description]"

3. **criteria**: 3-6 success criteria that:
   - Are observable from the conversation
   - Test one specific behavior each
   - Use clear, judgeable language (e.g., "Agent must acknowledge the error" not "Agent is helpful")

When refining an existing scenario, incorporate the user's feedback while preserving the overall structure and any parts they haven't asked to change.`;

export const app = new Hono().basePath("/api/scenario");
app.use(tracerMiddleware({ name: "scenario-generate" }));
app.use(loggerMiddleware());

app.post("/generate", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as NextRequest });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  let body;
  try {
    body = requestSchema.parse(await c.req.json());
  } catch (error) {
    logger.error({ error }, "Invalid request body");
    return c.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { prompt, currentScenario, projectId } = body;

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "scenarios:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  try {
    const model = await getVercelAIModel(projectId);

    const userPrompt = currentScenario
      ? `Current scenario:\n${JSON.stringify(currentScenario, null, 2)}\n\nUser request: ${prompt}`
      : prompt;

    const result = await generateObject({
      model,
      mode: "tool",
      schema: scenarioSchema,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    return c.json({ scenario: result.object });
  } catch (error) {
    logger.error({ error }, "Error generating scenario");

    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate scenario";

    return c.json({ error: errorMessage }, { status: 500 });
  }
});
