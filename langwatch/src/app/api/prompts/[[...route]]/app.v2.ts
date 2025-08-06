import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";

import {
  organizationMiddleware,
  type AuthMiddlewareVariables,
  type OrganizationMiddlewareVariables,
} from "../../middleware";
import {
  promptServiceMiddleware,
  type PromptServiceMiddlewareVariables,
} from "../../middleware/prompt-service";
import { baseResponses } from "../../shared/base-responses";

import { promptOutputSchema } from "./schemas";
import {
  buildStandardSuccessResponse,
  handlePossibleConflictError,
} from "./utils";

import {
  handleSchema,
  inputsSchema,
  messageSchema,
  outputsSchema,
  scopeSchema,
} from "~/prompt-configs/schemas/field-schemas";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:api:prompts");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = PromptServiceMiddlewareVariables &
  AuthMiddlewareVariables &
  OrganizationMiddlewareVariables;

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Middleware
app.use("/*", organizationMiddleware);
app.use("/*", promptServiceMiddleware);

// Create prompt with initial version
app.post(
  "/",
  describeRoute({
    description: "Create a new prompt with default initial version",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(promptOutputSchema),
    },
  }),
  zValidator(
    "json",
    z.object({
      handle: handleSchema,
      scope: scopeSchema,
      // Version data
      authorId: z.string().optional(),
      prompt: z.string().optional(),
      messages: z.array(messageSchema).optional(),
      inputs: z.array(inputsSchema).optional(),
      outputs: z.array(outputsSchema).optional(),
    })
  ),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const data = c.req.valid("json");

    logger.info(
      {
        handle: data.handle,
        scope: data.scope,
        projectId: project.id,
        organizationId: organization.id,
      },
      "Creating new prompt with initial version"
    );

    try {
      const newConfig = await service.createPrompt({
        projectId: project.id,
        handle: data.handle,
        organizationId: organization.id,
        scope: data.scope,
        authorId: data.authorId,
        prompt: data.prompt,
        messages: data.messages,
        inputs: data.inputs,
        outputs: data.outputs,
      });

      logger.info(
        { promptId: newConfig.id },
        "Successfully created prompt with initial version"
      );

      return c.json(newConfig);
    } catch (error: any) {
      logger.error({ projectId: project.id, error }, "Error creating prompt");
      handlePossibleConflictError(error, data.scope);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  }
);
