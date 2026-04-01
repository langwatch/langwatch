import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema, successSchema } from "~/app/api/shared/schemas";
import {
  commitMessageSchema,
  versionSchema,
} from "~/prompts/schemas/field-schemas";
import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { afterPromptCreated } from "~/../ee/billing/nurturing/hooks/promptCreation";
import { prisma } from "~/server/db";
import { NotFoundError, ShorthandParseError } from "~/server/prompt-config/errors";
import { TagValidationError } from "~/server/prompt-config/repositories/llm-config-tag.repository";
import { createLogger } from "~/utils/logger/server";
import { parsePromptShorthand } from "~/server/prompt-config/parsePromptShorthand";
import {
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagService,
  PromptTagValidationError,
} from "~/server/prompt-config/prompt-tag.service";
import {
  type AuthMiddlewareVariables,
  type OrganizationMiddlewareVariables,
  organizationMiddleware,
  resourceLimitMiddleware,
} from "../../middleware";
import {
  type PromptServiceMiddlewareVariables,
  promptServiceMiddleware,
} from "../../middleware/prompt-service";
import { baseResponses, conflictResponses } from "../../shared/base-responses";
import {
  type ApiResponsePrompt,
  apiResponsePromptWithVersionDataSchema,
  createPromptInputSchema,
  updatePromptInputSchema,
} from "./schemas";
import {
  buildStandardSuccessResponse,
  handlePossibleConflictError,
} from "./utils";
import { handleSystemPromptConflict } from "./utils/handle-system-prompt-conflict";

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

// Get all prompts
app.get(
  "/",
  describeRoute({
    description: "Get all prompts for a project",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(z.array(apiResponsePromptWithVersionDataSchema)),
          },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");

    logger.info({ projectId: project.id }, "Getting all prompts for project");

    const configs: ApiResponsePrompt[] = await service.getAllPrompts({
      projectId: project.id,
      organizationId: organization.id,
      version: "latest",
    });

    return c.json(
      apiResponsePromptWithVersionDataSchema.array().parse(configs),
    );
  },
);

// Assign tag to a prompt version
const assignTagResponseSchema = z.object({
  configId: z.string(),
  versionId: z.string(),
  tag: z.string(),
  updatedAt: z.date(),
});

app.put(
  "/:id{.+?}/tags/:tag",
  describeRoute({
    description:
      'Assign a tag (e.g. "production", "staging") to a specific prompt version',
    parameters: [
      {
        name: "tag",
        in: "path",
        description: 'The tag to assign (e.g., "production", "staging", or a custom tag)',
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(assignTagResponseSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
      422: {
        description: "Invalid tag or version",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", z.object({ versionId: z.string() })),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id, tag } = c.req.param();
    const { versionId } = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id, tag, versionId },
      "Assigning tag to prompt version",
    );

    try {
      const config = await service.repository.getPromptByIdOrHandle({
        idOrHandle: id,
        projectId: project.id,
        organizationId: organization.id,
      });

      if (!config) {
        throw new HTTPException(404, {
          message: `Prompt not found: ${id}`,
        });
      }

      const result = await service.assignTag({
        configId: config.id,
        versionId,
        tag,
        projectId: config.projectId,
        organizationId: organization.id,
      });

      logger.info(
        { projectId: project.id, configId: config.id, tag, versionId },
        "Successfully assigned tag to prompt version",
      );

      return c.json(
        assignTagResponseSchema.parse({
          configId: result.configId,
          versionId: result.versionId,
          tag: result.promptTag.name,
          updatedAt: result.updatedAt,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof TagValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      throw error;
    }
  },
);

// --- Tag definition CRUD (org-level) ---

// List all tag definitions for the org
app.get(
  "/tags",
  describeRoute({
    description: "List all prompt tag definitions for the organization",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(
              z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  createdAt: z.coerce.date(),
                }),
              ),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const organization = c.get("organization");
    const tagService = PromptTagService.create(prisma);
    const tags = await tagService.getAll({ organizationId: organization.id });

    return c.json(
      tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        createdAt: tag.createdAt,
      })),
    );
  },
);

// Create a tag definition
app.post(
  "/tags",
  describeRoute({
    description: "Create a custom prompt tag definition for the organization",
    responses: {
      ...baseResponses,
      201: {
        description: "Tag created",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                id: z.string(),
                name: z.string(),
                createdAt: z.coerce.date(),
              }),
            ),
          },
        },
      },
    },
  }),
  zValidator("json", z.object({ name: z.string() })),
  async (c) => {
    const organization = c.get("organization");
    const { name } = c.req.valid("json");
    const tagService = PromptTagService.create(prisma);

    try {
      const tag = await tagService.create({
        organizationId: organization.id,
        name,
      });

      logger.info({ organizationId: organization.id, name }, "Custom prompt tag created via REST");

      return c.json(
        { id: tag.id, name: tag.name, createdAt: tag.createdAt },
        201,
      );
    } catch (error) {
      if (error instanceof PromptTagValidationError) {
        throw new HTTPException(422, { message: error.message });
      }
      if (error instanceof PromptTagConflictError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  },
);

// Rename a tag definition
app.put(
  "/tags/:tag",
  describeRoute({
    description: "Rename a prompt tag definition",
    responses: {
      ...baseResponses,
      200: {
        description: "Tag renamed",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                id: z.string(),
                name: z.string(),
                createdAt: z.coerce.date(),
              }),
            ),
          },
        },
      },
    },
  }),
  zValidator("json", z.object({ name: z.string() })),
  async (c) => {
    const organization = c.get("organization");
    const { tag: oldName } = c.req.param();
    const { name: newName } = c.req.valid("json");
    const tagService = PromptTagService.create(prisma);

    try {
      const tag = await tagService.rename({
        organizationId: organization.id,
        oldName,
        newName,
      });

      logger.info(
        { organizationId: organization.id, oldName, newName },
        "Custom prompt tag renamed via REST",
      );

      return c.json({ id: tag.id, name: tag.name, createdAt: tag.createdAt });
    } catch (error) {
      if (error instanceof PromptTagValidationError) {
        throw new HTTPException(422, { message: error.message });
      }
      if (error instanceof PromptTagConflictError) {
        throw new HTTPException(409, { message: error.message });
      }
      if (error instanceof PromptTagProtectedError) {
        throw new HTTPException(422, { message: error.message });
      }
      if (error instanceof PromptTagNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  },
);

// Delete a tag definition
app.delete(
  "/tags/:tag",
  describeRoute({
    description: "Delete a prompt tag definition and cascade to assignments",
    responses: {
      ...baseResponses,
      204: { description: "Tag deleted" },
    },
  }),
  async (c) => {
    const organization = c.get("organization");
    const { tag: tagName } = c.req.param();
    const tagService = PromptTagService.create(prisma);

    try {
      const tag = await tagService.deleteByName({
        organizationId: organization.id,
        name: tagName,
      });

      if (!tag) {
        throw new HTTPException(404, {
          message: `Tag not found: ${tagName}`,
        });
      }

      logger.info(
        { organizationId: organization.id, tagName },
        "Custom prompt tag deleted via REST",
      );

      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof PromptTagProtectedError) {
        throw new HTTPException(422, { message: error.message });
      }
      throw error;
    }
  },
);

// Get versions
app.get(
  "/:id{.+?}/versions",
  describeRoute({
    description:
      "Get all versions for a prompt. Does not include base prompt data, only versioned data.",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(
        z.array(apiResponsePromptWithVersionDataSchema),
      ),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();

    logger.info(
      { projectId: project.id, promptId: id },
      "Getting versions for prompt",
    );

    const versions: ApiResponsePrompt[] = await service.getAllVersions({
      idOrHandle: id,
      projectId: project.id,
      organizationId: organization.id,
    });

    logger.info(
      { projectId: project.id, promptId: id, versionCount: versions.length },
      "Successfully retrieved prompt versions",
    );

    return c.json(
      apiResponsePromptWithVersionDataSchema.array().parse(versions),
    );
  },
);

// Get prompt by ID
app.get(
  "/:id{.+}",
  describeRoute({
    description:
      "Get a specific prompt by slug, with optional shorthand syntax for tags and versions. " +
      'Pass a bare slug like "pizza-prompt" to get the latest version, ' +
      '"pizza-prompt:production" to resolve a tagged version, or ' +
      '"pizza-prompt:2" to fetch version 2. ' +
      "Alternatively, use the tag or version query parameters with a bare slug.",
    parameters: [
      {
        name: "id",
        in: "path",
        description:
          "Prompt slug or shorthand. Supports three formats: " +
          '(1) bare slug — "pizza-prompt" returns the latest version; ' +
          '(2) slug:tag — "pizza-prompt:production" returns the version pointed to by that tag; ' +
          '(3) slug:version — "pizza-prompt:2" returns that specific version number. ' +
          '"slug:latest" is equivalent to the bare slug. ' +
          "Cannot be combined with the tag or version query parameters.",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "version",
        in: "query",
        description:
          "Specific version number to retrieve. Cannot be used when the id path already contains a shorthand suffix.",
        required: false,
        schema: { type: "integer", minimum: 0 },
      },
      {
        name: "tag",
        in: "query",
        description:
          "Fetch the version pointed to by this tag (e.g., \"production\", \"staging\"). " +
          "Cannot be used when the id path already contains a shorthand suffix.",
        required: false,
        schema: { type: "string" },
      },
    ],
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(apiResponsePromptWithVersionDataSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();

    try {
      // Parse shorthand syntax (e.g., "pizza-prompt:production" or "pizza-prompt:2")
      const shorthand = parsePromptShorthand(id);

      const queryVersion = c.req.query("version")
        ? parseInt(c.req.query("version") ?? "")
        : undefined;
      const queryTag = c.req.query("tag") ?? undefined;

      // Reject conflicting shorthand + query param
      if (shorthand.tag && queryTag) {
        throw new HTTPException(422, {
          message: `Conflict: shorthand path specifies tag "${shorthand.tag}" but query parameter also specifies tag "${queryTag}". Use one or the other, not both.`,
        });
      }

      if (shorthand.version && queryVersion) {
        throw new HTTPException(422, {
          message: `Conflict: shorthand path specifies version ${String(shorthand.version)} but query parameter also specifies version ${String(queryVersion)}. Use one or the other, not both.`,
        });
      }

      const version = shorthand.version ?? queryVersion;
      const tag = shorthand.tag ?? queryTag;

      logger.info(
        { projectId: project.id, id: shorthand.slug, version, tag },
        "Getting prompt",
      );

      const config = await service.getPromptByIdOrHandle({
        idOrHandle: shorthand.slug,
        projectId: project.id,
        organizationId: organization.id,
        version,
        tag,
      });

      if (!config) {
        throw new HTTPException(404, {
          message: "Prompt not found",
        });
      }

      return c.json(apiResponsePromptWithVersionDataSchema.parse(config));
    } catch (error: unknown) {
      if (error instanceof HTTPException) {
        throw error;
      }
      if (error instanceof TagValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      if (error instanceof NotFoundError) {
        throw new HTTPException(404, {
          message: error.message,
        });
      }
      if (error instanceof ShorthandParseError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      throw error;
    }
  },
);

// Create prompt with initial version
app.post(
  "/",
  resourceLimitMiddleware("prompts"),
  describeRoute({
    description: "Create a new prompt with default initial version",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(apiResponsePromptWithVersionDataSchema),
      409: conflictResponses[409],
    },
  }),
  zValidator("json", createPromptInputSchema),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { tags, ...data } = c.req.valid("json");

    logger.info(
      {
        handle: data.handle,
        scope: data.scope,
        projectId: project.id,
        organizationId: organization.id,
        tags,
      },
      "Creating new prompt with initial version",
    );

    try {
      const newConfig: ApiResponsePrompt = await service.createPrompt({
        projectId: project.id,
        organizationId: organization.id,
        ...data,
      });

      logger.info(
        { promptId: newConfig.id },
        "Successfully created prompt with initial version",
      );

      if (tags && tags.length > 0) {
        await Promise.all(
          tags.map((tag) =>
            service.assignTag({
              configId: newConfig.id,
              versionId: newConfig.versionId,
              tag,
              projectId: newConfig.projectId,
              organizationId: organization.id,
            }),
          ),
        );

        logger.info(
          { promptId: newConfig.id, tags },
          "Assigned tags to initial version",
        );
      }

      afterPromptCreated({
        prisma,
        projectId: project.id,
      });

      return c.json(apiResponsePromptWithVersionDataSchema.parse(newConfig));
    } catch (error: any) {
      logger.error({ projectId: project.id, error }, "Error creating prompt");
      if (error instanceof TagValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      handlePossibleConflictError(error, data.scope);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  },
);

// Sync endpoint for upsert operations
app.post(
  "/:id{.+?}/sync",
  describeRoute({
    description: "Sync/upsert a prompt with local content",
    responses: {
      ...baseResponses,
      200: {
        description: "Sync result",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                action: z.enum([
                  "created",
                  "updated",
                  "conflict",
                  "up_to_date",
                ]),
                prompt: apiResponsePromptWithVersionDataSchema.optional(),
                conflictInfo: z
                  .object({
                    localVersion: z.number(),
                    remoteVersion: z.number(),
                    differences: z.array(z.string()),
                    remoteConfigData:
                      getLatestConfigVersionSchema().shape.configData,
                  })
                  .optional(),
              }),
            ),
          },
        },
      },
    },
  }),
  zValidator(
    "json",
    z.object({
      configData: getLatestConfigVersionSchema().shape.configData,
      localVersion: versionSchema.optional(),
      commitMessage: commitMessageSchema.optional(),
    }),
  ),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, promptId: id },
      "Syncing prompt with local content",
    );

    try {
      const syncResult = await service.syncPrompt({
        idOrHandle: id,
        localConfigData: data.configData,
        localVersion: data.localVersion,
        projectId: project.id,
        organizationId: organization.id,
        commitMessage: data.commitMessage,
      });

      const response: any = {
        action: syncResult.action,
      };

      if (syncResult.prompt) {
        response.prompt = syncResult.prompt;
      }

      if (syncResult.conflictInfo) {
        response.conflictInfo = syncResult.conflictInfo;
      }

      logger.info(
        {
          projectId: project.id,
          promptId: id,
          action: syncResult.action,
        },
        "Successfully synced prompt",
      );

      if (syncResult.action === "created") {
        afterPromptCreated({
          prisma,
          projectId: project.id,
        });
      }

      return c.json(response);
    } catch (error: any) {
      logger.error(
        { projectId: project.id, promptId: id, error },
        "Error syncing prompt",
      );

      if (error.message.includes("No permission")) {
        throw new HTTPException(403, {
          message: error.message,
        });
      }

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  },
);

// Update prompt
app.put(
  "/:id{.+}",
  describeRoute({
    description: "Update a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(apiResponsePromptWithVersionDataSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
      409: conflictResponses[409],
      422: {
        description: "Invalid input",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", updatePromptInputSchema),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();
    const { tags, ...data } = c.req.valid("json");
    const projectId = project.id;

    if (Object.keys(data).length === 0) {
      throw new HTTPException(422, {
        message: "At least one field is required",
      });
    }

    logger.info(
      {
        projectId: project.id,
        handleOrId: id,
        data,
        tags,
      },
      "Updating prompt",
    );

    try {
      const updatedConfig: ApiResponsePrompt = await service.updatePrompt({
        idOrHandle: id,
        projectId,
        data,
      });

      if (!updatedConfig) {
        throw new HTTPException(404, {
          message: `Prompt not found: ${id}`,
        });
      }

      if (tags && tags.length > 0) {
        await Promise.all(
          tags.map((tag) =>
            service.assignTag({
              configId: updatedConfig.id,
              versionId: updatedConfig.versionId,
              tag,
              projectId: updatedConfig.projectId,
              organizationId: organization.id,
            }),
          ),
        );

        logger.info(
          { projectId, promptId: id, tags, versionId: updatedConfig.versionId },
          "Assigned tags to updated version",
        );
      }

      logger.info(
        {
          projectId,
          promptId: id,
          handle: updatedConfig.handle,
          scope: updatedConfig.scope,
        },
        "Successfully updated prompt",
      );

      return c.json(
        apiResponsePromptWithVersionDataSchema.parse(updatedConfig),
      );
    } catch (error: any) {
      logger.error({ projectId, promptId: id, error }, "Error updating prompt");
      if (error instanceof TagValidationError) {
        throw new HTTPException(422, {
          message: error.message,
        });
      }
      handlePossibleConflictError(error, data.scope);
      handleSystemPromptConflict(error);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  },
);
// Delete prompt
app.delete(
  "/:id{.+}",
  describeRoute({
    description: "Delete a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(successSchema),
      404: {
        description: "Prompt not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("promptService");
    const project = c.get("project");
    const organization = c.get("organization");
    const { id } = c.req.param();

    logger.info({ projectId: project.id, promptId: id }, "Deleting prompt");

    const result = await service.repository.deleteConfig(
      id,
      project.id,
      organization.id,
    );

    logger.info(
      { projectId: project.id, promptId: id, success: result.success },
      "Successfully deleted prompt",
    );

    return c.json(successSchema.parse(result));
  },
);
