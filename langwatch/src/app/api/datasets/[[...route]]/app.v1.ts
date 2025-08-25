import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";

import {
  type AuthMiddlewareVariables,
} from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { createManyDatasetRecords } from "../../../../server/api/routers/datasetRecord";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { prisma } from "../../../../server/db";
import { getVercelAIModel } from "../../../../server/modelProviders/utils";
import { smoothStream, stepCountIs, streamText, type CoreMessage } from "ai";

import { datasetOutputSchema, datasetEntriesInputSchema, datasetGenerateInputSchema } from "./schemas";
import { errorSchema, successSchema } from "../../shared/schemas";
import { tools } from "./tools";

import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:api:datasets");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = AuthMiddlewareVariables;

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>();

// Add entries to a dataset
app.post(
  "/:slugOrId/entries",
  describeRoute({
    description: "Add entries to a dataset",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(successSchema),
          },
        },
      },
    },
  }),
  zValidator("json", datasetEntriesInputSchema),
  async (c) => {
    const { slugOrId } = c.req.param();
    const project = c.get("project");
    const { entries } = c.req.valid("json");

    const dataset = await prisma.dataset.findFirst({
      where: {
        projectId: project.id,
        OR: [{ slug: slugOrId }, { id: slugOrId }],
      },
    });
    if (!dataset) {
      return c.json({ error: "Dataset not found" }, 404);
    }

    const columns = Object.fromEntries(
      (dataset.columnTypes as DatasetColumns).map((column) => [
        column.name,
        column.type,
      ])
    );
    for (const entry of entries) {
      for (const [key] of Object.entries(entry)) {
        if (!columns[key]) {
          return c.json(
            {
              error: `Column \`${key}\` is not present in the \`${dataset.name}\` dataset`,
            },
            400
          );
        }
      }
    }

    const now = Date.now();

    await createManyDatasetRecords({
      datasetId: dataset.id,
      projectId: project.id,
      datasetRecords: entries.map((entry, index) => ({
        id: `${now}-${index}`,
        ...entry,
      })),
    });

    return c.json({ success: true });
  }
);

// Get a dataset by its slug or id
app.get(
  "/:slugOrId",
  describeRoute({
    description: "Get a dataset by its slug or id.",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(datasetOutputSchema),
          },
        },
      },
      404: {
        description: "Dataset not found",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const { slugOrId } = c.req.param();
    if (!slugOrId) {
      return c.json({ error: "Dataset slug or id is required" }, 422);
    }

    const project = c.get("project");

    const dataset = await prisma.dataset.findFirst({
      where: {
        projectId: project.id,
        OR: [{ slug: slugOrId }, { id: slugOrId }],
      },
    });
    if (!dataset) {
      return c.json({ error: "Dataset not found" }, 404);
    }

    return c.json(dataset);
  }
);

// Generate dataset entries
app.post(
  "/generate",
  describeRoute({
    description: "Generate dataset entries using AI",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "text/plain": {
            schema: {
              type: "string",
            },
          },
        },
      },
    },
  }),
  zValidator("json", datasetGenerateInputSchema),
  async (c) => {
    const project = c.get("project");
    const { messages, dataset, projectId } = c.req.valid("json");

    if (!projectId) {
      return c.json(
        { error: "Missing projectId" },
        400
      );
    }

    // Verify that the projectId matches the authenticated project
    if (projectId !== project.id) {
      return c.json(
        { error: "Project ID mismatch" },
        403
      );
    }

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
      messages: messages as CoreMessage[],
      maxOutputTokens: 4096 * 2,
      stopWhen: stepCountIs(20),
      experimental_transform: smoothStream({ chunking: "word" }),
      tools: tools,
      maxRetries: 3,
      onError: (error) => {
        logger.error({ error }, "error in streamtext");
      },
    });

    return result.toTextStreamResponse();
  }
);
