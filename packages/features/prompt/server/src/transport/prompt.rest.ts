/**
 * The `/api/prompts` REST family: a project's prompts, their versions and the
 * organization tag catalogue those versions are labelled from.
 *
 * Literal addressing, because `/api/prompts/...` and its `/api/v1` twin are the
 * whole published contract: the `/:id{.+}` doors below would swallow a dated
 * namespace segment, so the family has never had one.
 */
import {
  badRequestSchema,
  baseResponses,
  conflictResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  successSchema,
  type RouteResponse,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  commitMessageSchema,
  getLatestConfigVersionSchema,
  handleSchema,
  inputsSchema,
  messageSchema,
  modelNameSchema,
  outputsSchema,
  parsePromptShorthand,
  PromptApi,
  promptSyncResultSchema,
  PromptHandleTakenError,
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
  runtimeParametersSchema,
  schemaVersionSchema,
  scopeSchema,
  type PromptScope,
  ShorthandParseError,
  SystemPromptConflictError,
  SystemPromptRequiredError,
  versionSchema,
} from "@langwatch/prompt-contract";
import { HTTPException } from "hono/http-exception";
import { z, type ZodSchema } from "zod";

// ── wire schemas ─────────────────────────────────────────────────────────────

/**
 * Schema for creating new prompt versions
 * Uses the latest config version schema from the repository
 */
export const versionInputSchema = getLatestConfigVersionSchema();

/**
 * Create prompt input schema
 */
export const createPromptInputSchema = z.strictObject({
  handle: handleSchema,
  scope: scopeSchema.optional().default("PROJECT"),
  // Version data
  model: modelNameSchema.optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  commitMessage: commitMessageSchema.optional(),
  authorId: z.string().optional(),
  prompt: z.string().optional(),
  messages: z.array(messageSchema).optional(),
  inputs: z.array(inputsSchema).optional(),
  outputs: z.array(outputsSchema).optional(),
  schemaVersion: schemaVersionSchema.optional(),
  /** Tags to assign to the initial version (e.g. ["production", "staging", "canary"]) */
  tags: z.array(z.string().min(1)).optional(),
  parameters: runtimeParametersSchema.optional(),
});

export const updatePromptInputSchema = z.strictObject({
  ...createPromptInputSchema.omit({ scope: true, handle: true }).shape,
  // commitMessage is required for updates (creates new version)
  commitMessage: commitMessageSchema,
  // Scope is optional, but on the update we don't want to set the default
  scope: scopeSchema.optional(),
  handle: handleSchema.optional(),
});

export const updateHandleInputSchema = z.strictObject({
  handle: handleSchema,
  scope: scopeSchema,
});

const configDataSchema = getLatestConfigVersionSchema().shape.configData;

/**
 * Base schema for API Response (only llm config)
 */
const apiResponsePromptSchemaBase = z.object({
  id: z.string(),
  handle: z.string().nullable(),
  scope: scopeSchema,
  name: z.string(),
  updatedAt: z.date(),
  projectId: z.string(),
  organizationId: z.string(),
});

/**
 * Tag association for a prompt version. `versionId` is the version this tag currently
 * points to - included so callers can distinguish whether the tag points to the
 * prompt/version they're looking at.
 */
export const apiResponsePromptTagSchema = z.object({
  name: z.string(),
  versionId: z.string(),
});

/**
 * Schema for version output responses
 * Derives configData fields from storage schema to prevent drift
 */
const apiResponseVersionOutputSchema = z.object({
  configId: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  authorId: z.string().nullable().optional(),
  version: z.number(),
  createdAt: z.date(),
  commitMessage: z.string().optional().nullable(),
  // Derived from storage schema
  prompt: configDataSchema.shape.prompt,
  messages: configDataSchema.shape.messages,
  inputs: configDataSchema.shape.inputs,
  outputs: configDataSchema.shape.outputs,
  model: configDataSchema.shape.model,
  temperature: configDataSchema.shape.temperature,
  maxTokens: configDataSchema.shape.max_tokens,
  demonstrations: configDataSchema.shape.demonstrations,
  promptingTechnique: configDataSchema.shape.prompting_technique,
  responseFormat: configDataSchema.shape.response_format,
  tags: z.array(apiResponsePromptTagSchema).default([]),
  parameters: runtimeParametersSchema,
});

/**
 * Expected shape for a returned prompt from the API
 *
 * Includes llm config + version data
 */
export const apiResponsePromptWithVersionDataSchema = z.object({
  ...apiResponsePromptSchemaBase.shape,
  ...apiResponseVersionOutputSchema.omit({ configId: true }).shape,
});

export type ApiResponsePrompt = z.infer<typeof apiResponsePromptWithVersionDataSchema>;

/** One prompt as this family publishes it: the payload plus its deep link. */
const promptWireSchema = z.object({
  ...apiResponsePromptWithVersionDataSchema.shape,
  platformUrl: z.string(),
});

// ── the facts the process resolves ───────────────────────────────────────────

/**
 * What this family knows about the project behind the credential that the
 * request itself does not carry: the organization the project belongs to (a
 * tag catalogue is an organization row), and the deep link back into the
 * prompt library, which is built from the deployment's own origin.
 */
export const promptRestFacts = defineRestMiddleware(
  "promptRestFacts",
  z.object({
    organizationId: z.string(),
    promptsUrl: z.string(),
  }),
);

/**
 * The credential this request arrived on, as the tag catalogue's cascade reads
 * it. A legacy project key names no key row, so it can only ever answer for the
 * one project it is pinned to.
 */
export const promptRestCredential = defineRestMiddleware(
  "promptRestCredential",
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("apiKey"),
      apiKeyId: z.string(),
      userId: z.string().nullable(),
      organizationId: z.string(),
    }),
    z.object({ type: z.literal("legacyProjectKey"), projectId: z.string() }),
  ]),
);

// ── OpenAPI + refusal helpers ────────────────────────────────────────────────

/**
 * @param zodSchema - The Zod schema that defines the shape of the response data
 * @returns A RouteResponse object with standardized success structure
 */
export const buildStandardSuccessResponse = (zodSchema: ZodSchema): RouteResponse => {
  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};

/**
 * Maps the taken-handle refusal persistence raises onto the 409 this family has
 * always answered, naming the scope the write asked for.
 */
export const handlePossibleConflictError = (error: unknown, scope: PromptScope = "PROJECT") => {
  if (error instanceof PromptHandleTakenError) {
    throw new HTTPException(409, {
      message: `Prompt handle already exists for scope ${scope}`,
      cause: error,
    });
  }
};

/**
 * Maps system-prompt HandledErrors thrown by the prompt service to Hono HTTP exceptions
 * @param error - The error to handle
 * @returns void
 */
export const handleSystemPromptHandledErrors = (error: unknown) => {
  if (error instanceof SystemPromptRequiredError) {
    throw new HTTPException(400, {
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof SystemPromptConflictError) {
    throw new HTTPException(409, {
      message: error.message,
      cause: error,
    });
  }
};

// ── the family ───────────────────────────────────────────────────────────────

const logger = createLogger("langwatch:api:prompts");

/** What a tag assignment answers with. */
const assignTagResponseSchema = z.object({
  configId: z.string(),
  versionId: z.string(),
  tag: z.string(),
  updatedAt: z.date(),
});

/** One organization-level tag definition, as the tag doors publish it. */
const tagDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
});

/** What a sync sends: the local content, and the version it was taken from. */
const syncInputSchema = z.object({
  configData: getLatestConfigVersionSchema().shape.configData,
  parameters: z.record(z.string(), z.unknown()).optional(),
  localVersion: versionSchema.optional(),
  commitMessage: commitMessageSchema.optional(),
});

/** What a sync answers with: what it did, and the conflict when it did nothing. */
const documentedSyncResultSchema = z.object({
  action: z.enum(["created", "updated", "conflict", "up_to_date"]),
  prompt: apiResponsePromptWithVersionDataSchema.optional(),
  conflictInfo: z
    .object({
      localVersion: z.number(),
      remoteVersion: z.number(),
      differences: z.array(z.string()),
      remoteConfigData: getLatestConfigVersionSchema().shape.configData,
      remoteParameters: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

const idParamsSchema = z.object({ id: z.string() });
const idTagParamsSchema = z.object({ id: z.string(), tag: z.string() });
const tagParamsSchema = z.object({ tag: z.string() });
const idVersionParamsSchema = z.object({ id: z.string(), versionId: z.string() });

/** The two window parameters a bare slug may name instead of a shorthand. */
const promptWindowQuerySchema = z.object({
  version: z.string().optional(),
  tag: z.string().optional(),
});

const notFoundResponse: RouteResponse = {
  description: "Prompt not found",
  content: { "application/json": { schema: resolver(badRequestSchema) } },
};

export const promptRest = defineRestRouter(PromptApi)
  .withNamespace("prompts")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .get("/api/prompts", "listPrompts")
  .withPermission("prompts:view")
  .withOutput(z.array(promptWireSchema))
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: "Get all prompts for a project",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(z.array(promptWireSchema)),
    },
  })
  .handle(async ({ app, scope }, project) => {
    logger.info({ projectId: scope.id }, "Getting all prompts for project");

    const configs = await app.getAllPrompts({
      projectId: scope.id,
      organizationId: project.organizationId,
      version: "latest",
    });

    return configs.map((config) => ({
      ...apiResponsePromptWithVersionDataSchema.parse(config),
      platformUrl: project.promptsUrl,
    }));
  })

  // Assigning a tag changes an existing prompt; it creates nothing. Moving a
  // tag is not editing a prompt - it repoints the release pointer, and so
  // decides which version the customer's live traffic resolves to. That is a
  // deployment, and it belongs with the grain that administers the prompt
  // rather than with the one that edits its text.
  .put("/api/prompts/:id{.+?}/tags/:tag", "assignPromptTag")
  .withParams(idTagParamsSchema)
  .withInput(z.object({ versionId: z.string() }))
  .withPermission("prompts:manage")
  .withOutput(assignTagResponseSchema)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: 'Assign a tag (e.g. "production", "staging") to a specific prompt version',
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(assignTagResponseSchema),
      404: notFoundResponse,
      422: {
        description: "Invalid tag or version",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    const { id, tag, versionId } = input;

    logger.info(
      { projectId: scope.id, promptId: id, tag, versionId },
      "Assigning tag to prompt version",
    );

    try {
      const config = await app.tryGetPromptByIdOrHandle({
        idOrHandle: id,
        projectId: scope.id,
        organizationId: project.organizationId,
      });

      if (!config) throw new HTTPException(404, { message: `Prompt not found: ${id}` });

      // The lookup above also matches org-scoped prompts a SIBLING project
      // owns, so the row's own projectId is not the one the credential was
      // authorized on. The write goes to the authorized project.
      const result = await app.assignTag({
        configId: config.id,
        versionId,
        tag,
        projectId: scope.id,
        organizationId: project.organizationId,
      });

      logger.info(
        { projectId: scope.id, configId: config.id, tag, versionId },
        "Successfully assigned tag to prompt version",
      );

      return {
        configId: result.configId,
        versionId: result.versionId,
        tag: result.promptTag.name,
        updatedAt: result.updatedAt,
      };
    } catch (error: unknown) {
      if (error instanceof PromptTagValidationError) {
        throw new HTTPException(422, { message: error.message });
      }
      throw error;
    }
  })

  // --- Tag definition CRUD (org-level) ---

  .get("/api/prompts/tags", "listPromptTags")
  .withPermission("prompts:view")
  .withOutput(z.array(tagDefinitionSchema))
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: "List all prompt tag definitions for the organization",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(z.array(tagDefinitionSchema)),
    },
  })
  .handle(async ({ app }, project) => {
    const tags = await app.listTags({ organizationId: project.organizationId });

    return tags.map((tag) => ({ id: tag.id, name: tag.name, createdAt: tag.createdAt }));
  })

  .post("/api/prompts/tags", "createPromptTag")
  .withInput(z.object({ name: z.string() }))
  .withPermission("prompts:manage")
  .withOutput(tagDefinitionSchema)
  .withStatus(201)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: "Create a custom prompt tag definition for the organization",
    responses: {
      ...baseResponses,
      201: {
        description: "Tag created",
        content: { "application/json": { schema: resolver(tagDefinitionSchema) } },
      },
    },
  })
  .handle(async ({ app, input }, project) => {
    try {
      const tag = await app.createTag({
        organizationId: project.organizationId,
        name: input.name,
      });

      logger.info(
        { organizationId: project.organizationId, name: input.name },
        "Custom prompt tag created via REST",
      );

      return { id: tag.id, name: tag.name, createdAt: tag.createdAt };
    } catch (error) {
      throw asTagWriteRefusal(error);
    }
  })

  .put("/api/prompts/tags/:tag", "renamePromptTag")
  .withParams(tagParamsSchema)
  .withInput(z.object({ name: z.string() }))
  .withPermission("prompts:manage")
  .withOutput(tagDefinitionSchema)
  .withMiddleware(promptRestFacts, promptRestCredential)
  .withDocs({
    description: "Rename a prompt tag definition",
    responses: {
      ...baseResponses,
      200: {
        description: "Tag renamed",
        content: { "application/json": { schema: resolver(tagDefinitionSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, project, credential) => {
    await app.assertMayManageTagCatalog({ projectId: scope.id, by: credential });

    try {
      const tag = await app.renameTag({
        organizationId: project.organizationId,
        oldName: input.tag,
        newName: input.name,
      });

      logger.info(
        { organizationId: project.organizationId, oldName: input.tag, newName: input.name },
        "Custom prompt tag renamed via REST",
      );

      return { id: tag.id, name: tag.name, createdAt: tag.createdAt };
    } catch (error) {
      throw asTagWriteRefusal(error);
    }
  })

  .delete("/api/prompts/tags/:tag", "deletePromptTag")
  .withParams(tagParamsSchema)
  .withPermission("prompts:manage")
  .withMiddleware(promptRestFacts, promptRestCredential)
  .withDocs({
    description: "Delete a prompt tag definition and cascade to assignments",
    responses: { ...baseResponses, 204: { description: "Tag deleted" } },
  })
  .handle(async ({ app, input, scope }, project, credential) => {
    await app.assertMayManageTagCatalog({ projectId: scope.id, by: credential });

    try {
      const tag = await app.tryDeleteTagByName({
        organizationId: project.organizationId,
        name: input.tag,
      });

      if (!tag) throw new HTTPException(404, { message: `Tag not found: ${input.tag}` });

      logger.info(
        { organizationId: project.organizationId, tagName: input.tag },
        "Custom prompt tag deleted via REST",
      );
    } catch (error) {
      if (error instanceof PromptTagProtectedError) {
        throw new HTTPException(422, { message: error.message });
      }
      throw error;
    }
  })

  .get("/api/prompts/:id{.+?}/versions", "listPromptVersions")
  .withParams(idParamsSchema)
  .withPermission("prompts:view")
  .withOutput(z.array(promptWireSchema))
  .withMiddleware(promptRestFacts)
  .withDocs({
    description:
      "Get all versions for a prompt. Does not include base prompt data, only versioned data.",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(z.array(promptWireSchema)),
      404: notFoundResponse,
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    logger.info({ projectId: scope.id, promptId: input.id }, "Getting versions for prompt");

    const versions = await app.getAllVersions({
      idOrHandle: input.id,
      projectId: scope.id,
      organizationId: project.organizationId,
    });

    logger.info(
      { projectId: scope.id, promptId: input.id, versionCount: versions.length },
      "Successfully retrieved prompt versions",
    );

    return versions.map((version) => ({
      ...apiResponsePromptWithVersionDataSchema.parse(version),
      platformUrl: project.promptsUrl,
    }));
  })

  // Restore (rollback to) a specific version - a new version of a prompt that
  // already exists, i.e. an update of that prompt.
  .post("/api/prompts/:id{.+?}/versions/:versionId/restore", "restorePromptVersion")
  .withParams(idVersionParamsSchema)
  .withPermission("prompts:update")
  .withOutput(promptWireSchema)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description:
      "Restore a prompt to a previous version. Creates a new version with the same config data as the specified version.",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(promptWireSchema),
      404: {
        description: "Prompt or version not found",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    logger.info(
      { projectId: scope.id, promptId: input.id, versionId: input.versionId },
      "Restoring prompt version",
    );

    // A missing prompt or version arrives as a `NotFoundError`, which is a
    // `HandledError`: the boundary serialises it into the standard body (code
    // `prompt_not_found`, 404, trace ids) rather than untyped prose.
    const restored = await app.restoreVersion({
      versionId: input.versionId,
      projectId: scope.id,
      organizationId: project.organizationId,
    });

    logger.info(
      { projectId: scope.id, promptId: input.id, versionId: input.versionId },
      "Successfully restored prompt version",
    );

    return {
      ...apiResponsePromptWithVersionDataSchema.parse(restored),
      platformUrl: project.promptsUrl,
    };
  })

  .get("/api/prompts/:id{.+}", "getPrompt")
  .withParams(idParamsSchema)
  .withQuery(promptWindowQuerySchema)
  .withPermission("prompts:view")
  .withOutput(promptWireSchema)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description:
      "Get a specific prompt by slug, with optional shorthand syntax for tags and versions. " +
      'Pass a bare slug like "pizza-prompt" to get the latest version, ' +
      '"pizza-prompt:production" to resolve a tagged version, or ' +
      '"pizza-prompt:2" to fetch version 2. ' +
      "Alternatively, use the tag or version query parameters with a bare slug.",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(promptWireSchema),
      404: notFoundResponse,
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    try {
      // Parse shorthand syntax (e.g., "pizza-prompt:production" or "pizza-prompt:2")
      const shorthand = parsePromptShorthand(input.id);

      // The two window parameters stay unrefused by their schema: a caller that
      // sends `version=abc` is answered by the conflict and shorthand rules
      // below, exactly as it always has been.
      const queryVersion = input.version ? parseInt(input.version) : undefined;
      const queryTag = input.tag;

      // Reject conflicting shorthand + query param. hadSuffix is true even for
      // "latest" (which normalizes away), so "foo:latest?tag=production" is
      // correctly rejected.
      if (shorthand.hadSuffix && (queryTag || queryVersion)) {
        throw new HTTPException(422, {
          message: `Conflict: shorthand syntax in path cannot be combined with tag or version query parameters. Use one or the other, not both.`,
        });
      }

      const version = shorthand.version ?? queryVersion;
      const tag = shorthand.tag ?? queryTag;

      logger.info({ projectId: scope.id, id: shorthand.slug, version, tag }, "Getting prompt");

      const config = await app.tryGetPromptByIdOrHandle({
        idOrHandle: shorthand.slug,
        projectId: scope.id,
        organizationId: project.organizationId,
        ...(version === undefined ? {} : { version }),
        ...(tag === undefined ? {} : { tag }),
      });

      if (!config) throw new HTTPException(404, { message: "Prompt not found" });

      return {
        ...apiResponsePromptWithVersionDataSchema.parse(config),
        platformUrl: project.promptsUrl,
      };
    } catch (error: unknown) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof PromptTagValidationError) {
        throw new HTTPException(422, { message: error.message });
      }
      // `NotFoundError` is a `HandledError` and is left to propagate: the
      // boundary serialises it with its `prompt_not_found` code, and re-wrapping
      // it would flatten that back down to a bare status plus prose.
      if (error instanceof ShorthandParseError) {
        throw new HTTPException(422, { message: error.message });
      }
      throw error;
    }
  })

  // Create prompt with initial version. Asks for `prompts:create`; `:manage`
  // still implies it, so no existing caller changes, and a viewer holding only
  // `prompts:view` is declined exactly as before.
  .post("/api/prompts", "createPrompt")
  .withInput(createPromptInputSchema)
  .withPermission("prompts:create")
  .withOutput(promptWireSchema)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: "Create a new prompt with default initial version",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(promptWireSchema),
      409: conflictResponses[409],
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    const { tags, ...data } = input;

    logger.info(
      {
        handle: data.handle,
        scope: data.scope,
        projectId: scope.id,
        organizationId: project.organizationId,
        tags,
      },
      "Creating new prompt with initial version",
    );

    try {
      const created = await app.createPrompt({
        projectId: scope.id,
        organizationId: project.organizationId,
        ...data,
      });

      logger.info({ promptId: created.id }, "Successfully created prompt with initial version");

      const answered = await assignInitialTags({
        app,
        prompt: created,
        tags,
        projectId: scope.id,
        organizationId: project.organizationId,
      });

      app.announceCreated({ projectId: scope.id });

      return {
        ...apiResponsePromptWithVersionDataSchema.parse(answered),
        platformUrl: project.promptsUrl,
      };
    } catch (error: unknown) {
      logger.error({ projectId: scope.id, error }, "Error creating prompt");
      if (error instanceof PromptTagValidationError) {
        throw new HTTPException(422, { message: error.message });
      }
      handlePossibleConflictError(error, data.scope);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  })

  .post("/api/prompts/:id{.+?}/sync", "syncPrompt")
  .withParams(idParamsSchema)
  .withInput(syncInputSchema)
  .withPermission("prompts:manage")
  .withOutput(promptSyncResultSchema)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: "Sync/upsert a prompt with local content",
    responses: {
      ...baseResponses,
      200: {
        description: "Sync result",
        content: { "application/json": { schema: resolver(documentedSyncResultSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    const { id, ...data } = input;

    logger.info({ projectId: scope.id, promptId: id }, "Syncing prompt with local content");

    try {
      const syncResult = await app.syncPrompt({
        idOrHandle: id,
        localConfigData: data.configData,
        localVersion: data.localVersion,
        projectId: scope.id,
        organizationId: project.organizationId,
        commitMessage: data.commitMessage,
        parameters: data.parameters,
      });

      logger.info(
        { projectId: scope.id, promptId: id, action: syncResult.action },
        "Successfully synced prompt",
      );

      if (syncResult.action === "created") app.announceCreated({ projectId: scope.id });

      return syncResult;
    } catch (error: unknown) {
      logger.error({ projectId: scope.id, promptId: id, error }, "Error syncing prompt");

      if (error instanceof Error && error.message.includes("No permission")) {
        throw new HTTPException(403, { message: error.message });
      }

      if (error instanceof PromptTagValidationError) {
        throw new HTTPException(422, { message: error.message });
      }

      // Translate a taken handle into a readable 409 instead of bubbling up as
      // "Internal server error".
      handlePossibleConflictError(error);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  })

  .put("/api/prompts/:id{.+}", "updatePrompt")
  .withParams(idParamsSchema)
  .withInput(updatePromptInputSchema)
  .withPermission("prompts:update")
  .withOutput(promptWireSchema)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: "Update a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(promptWireSchema),
      404: notFoundResponse,
      409: conflictResponses[409],
      422: {
        description: "Invalid input",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    const { id, tags, ...data } = input;

    if (Object.keys(data).length === 0) {
      throw new HTTPException(422, { message: "At least one field is required" });
    }

    logger.info({ projectId: scope.id, handleOrId: id, data, tags }, "Updating prompt");

    try {
      const updated = await app.updatePrompt({ idOrHandle: id, projectId: scope.id, data });

      if (!updated) throw new HTTPException(404, { message: `Prompt not found: ${id}` });

      const answered = await assignInitialTags({
        app,
        prompt: updated,
        tags,
        projectId: scope.id,
        organizationId: project.organizationId,
      });

      logger.info(
        { projectId: scope.id, promptId: id, handle: updated.handle, scope: updated.scope },
        "Successfully updated prompt",
      );

      return {
        ...apiResponsePromptWithVersionDataSchema.parse(answered),
        platformUrl: project.promptsUrl,
      };
    } catch (error: unknown) {
      logger.error({ projectId: scope.id, promptId: id, error }, "Error updating prompt");
      if (error instanceof PromptTagValidationError) {
        throw new HTTPException(422, { message: error.message });
      }
      handlePossibleConflictError(error, data.scope);
      handleSystemPromptHandledErrors(error);

      // Re-throw other errors to be handled by the error middleware
      throw error;
    }
  })

  .delete("/api/prompts/:id{.+}", "deletePrompt")
  .withParams(idParamsSchema)
  .withPermission("prompts:manage")
  .withOutput(successSchema)
  .withMiddleware(promptRestFacts)
  .withDocs({
    description: "Delete a prompt",
    responses: {
      ...baseResponses,
      200: buildStandardSuccessResponse(successSchema),
      404: notFoundResponse,
    },
  })
  .handle(async ({ app, input, scope }, project) => {
    logger.info({ projectId: scope.id, promptId: input.id }, "Deleting prompt");

    const result = await app.deletePrompt({
      idOrHandle: input.id,
      projectId: scope.id,
      organizationId: project.organizationId,
    });

    logger.info(
      { projectId: scope.id, promptId: input.id, success: result.success },
      "Successfully deleted prompt",
    );

    return result;
  })
  .build();

/**
 * The tag names a create or an update carried, applied to the version it just
 * wrote. The prompt is re-read afterwards so the answer carries the tags it now
 * holds rather than the ones it had a moment before.
 */
async function assignInitialTags(options: {
  app: PromptApi;
  prompt: ApiResponsePrompt;
  tags: string[] | undefined;
  projectId: string;
  organizationId: string;
}): Promise<ApiResponsePrompt> {
  const { app, prompt, tags, projectId, organizationId } = options;

  if (!tags || tags.length === 0) return prompt;

  await Promise.all(
    tags.map((tag) =>
      app.assignTag({
        configId: prompt.id,
        versionId: prompt.versionId,
        tag,
        projectId: prompt.projectId,
        organizationId,
      }),
    ),
  );

  logger.info({ promptId: prompt.id, tags }, "Assigned tags to version");

  const refetched = await app.tryGetPromptByIdOrHandle({
    idOrHandle: prompt.id,
    projectId,
    organizationId,
  });

  return refetched ? apiResponsePromptWithVersionDataSchema.parse(refetched) : prompt;
}

/** The statuses a tag definition write answers its four domain refusals with. */
function asTagWriteRefusal(error: unknown): unknown {
  if (error instanceof PromptTagValidationError) {
    return new HTTPException(422, { message: error.message });
  }
  if (error instanceof PromptTagConflictError) {
    return new HTTPException(409, { message: error.message });
  }
  if (error instanceof PromptTagProtectedError) {
    return new HTTPException(422, { message: error.message });
  }
  if (error instanceof PromptTagNotFoundError) {
    return new HTTPException(404, { message: error.message });
  }

  return error;
}
