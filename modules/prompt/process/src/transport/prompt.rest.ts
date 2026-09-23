/**
 * The `/api/prompts` REST family: a project's prompts, their versions and
 * the tag catalogue those versions are labelled from. Literal addressing -
 * the `/:id{.+}` doors below would swallow a dated namespace segment.
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
  getLatestConfigVersionSchema,
  parsePromptShorthand,
  PromptApi,
  type ApiResponsePrompt,
  apiResponsePromptWithVersionDataSchema,
  assignTagInputSchema,
  assignTagResponseSchema,
  promptSyncResultSchema,
  createPromptInputSchema,
  createTagInputSchema,
  documentedSyncResultSchema,
  idParamsSchema,
  idTagParamsSchema,
  idVersionParamsSchema,
  restorePromptVersionBodySchema,
  promptWindowQuerySchema,
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
  type PromptScope,
  renameTagInputSchema,
  ShorthandParseError,
  SystemPromptConflictError,
  SystemPromptRequiredError,
  promptWireSchema,
  syncInputSchema,
  tagDefinitionSchema,
  tagParamsSchema,
  updatePromptInputSchema,
} from "@langwatch/prompt-contract";
import { HTTPException } from "hono/http-exception";
import { z, type ZodSchema } from "zod";

export const versionInputSchema = getLatestConfigVersionSchema();

// ── the facts the process resolves ───────────────────────────────────────────

/**
 * What this family knows about the project that the credential itself does
 * not carry: the organization it belongs to (a tag catalogue is an
 * organization row), and the deep link back into the library, from the deployment's own origin.
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
 * Maps other conflict refusals, if any, onto the 409 this family has
 * always answered, naming the scope the write asked for.
 * PromptHandleTakenError is now a handled error and reaches the boundary itself.
 */
export const handlePossibleConflictError = (error: unknown, scope: PromptScope = "PROJECT") => {
  // Reserved for other conflict handlers; currently all are handled errors.
  void scope;
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

const notFoundResponse: RouteResponse = {
  description: "Prompt not found",
  content: { "application/json": { schema: resolver(badRequestSchema) } },
};

export const promptRest = defineRestRouter(PromptApi)
  .withNamespace("prompts")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .get("/api/prompts", "getApiPrompts")
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
  .put("/api/prompts/:promptId{.+?}/tags/:tag", "putApiPromptsByIdTagsByTag")
  .withParams(idTagParamsSchema)
  .withInput(assignTagInputSchema)
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
    const { promptId: id, tag, versionId } = input;

    logger.info(
      { projectId: scope.id, promptId: id, tag, versionId },
      "Assigning tag to prompt version",
    );

    try {
      const config = await app.getByIdOrHandle({
        idOrHandle: id,
        projectId: scope.id,
        organizationId: project.organizationId,
      });

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

  .get("/api/prompts/tags", "getApiPromptsTags")
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

  .post("/api/prompts/tags", "postApiPromptsTags")
  .withInput(createTagInputSchema)
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

  .put("/api/prompts/tags/:tag", "putApiPromptsTagsByTag")
  .withParams(tagParamsSchema)
  .withInput(renameTagInputSchema)
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

  .delete("/api/prompts/tags/:tag", "deleteApiPromptsTagsByTag")
  .withParams(tagParamsSchema)
  .withPermission("prompts:manage")
  .withOutput(z.void())
  .withMiddleware(promptRestFacts, promptRestCredential)
  .withDocs({
    description: "Delete a prompt tag definition and cascade to assignments",
    responses: { ...baseResponses, 204: { description: "Tag deleted", content: {} } },
  })
  .handle(async ({ app, input, scope }, project, credential) => {
    await app.assertMayManageTagCatalog({ projectId: scope.id, by: credential });

    try {
      await app.deleteTagByName({
        organizationId: project.organizationId,
        name: input.tag,
      });

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

  .get("/api/prompts/:promptId{.+?}/versions", "getApiPromptsByIdVersions")
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
    logger.info({ projectId: scope.id, promptId: input.promptId }, "Getting versions for prompt");

    const versions = await app.getAllVersions({
      idOrHandle: input.promptId,
      projectId: scope.id,
      organizationId: project.organizationId,
    });

    logger.info(
      { projectId: scope.id, promptId: input.promptId, versionCount: versions.length },
      "Successfully retrieved prompt versions",
    );

    return versions.map((version) => ({
      ...apiResponsePromptWithVersionDataSchema.parse(version),
      platformUrl: project.promptsUrl,
    }));
  })

  // Restore (rollback to) a specific version - a new version of a prompt that
  // already exists, i.e. an update of that prompt.
  .post(
    "/api/prompts/:promptId{.+?}/versions/:versionId/restore",
    "postApiPromptsByIdVersionsByVersionIdRestore",
  )
  .withParams(idVersionParamsSchema)
  .withInput(restorePromptVersionBodySchema)
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
      { projectId: scope.id, promptId: input.promptId, versionId: input.versionId },
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
      { projectId: scope.id, promptId: input.promptId, versionId: input.versionId },
      "Successfully restored prompt version",
    );

    return {
      ...apiResponsePromptWithVersionDataSchema.parse(restored),
      platformUrl: project.promptsUrl,
    };
  })

  .get("/api/prompts/:promptId{.+}", "getApiPromptsById")
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
      const shorthand = parsePromptShorthand(input.promptId);

      // The two window parameters stay unrefused by their schema: a caller that
      // sends `version=abc` is answered by the conflict and shorthand rules
      // below, exactly as it always has been.
      const queryVersion = input.version;
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

      const config = await app.getByIdOrHandle({
        idOrHandle: shorthand.slug,
        projectId: scope.id,
        organizationId: project.organizationId,
        ...(version === undefined ? {} : { version }),
        ...(tag === undefined ? {} : { tag }),
      });

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
  .post("/api/prompts", "postApiPrompts")
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

  .post("/api/prompts/:promptId{.+?}/sync", "postApiPromptsByIdSync")
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
    const { promptId: id, ...data } = input;

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

  .put("/api/prompts/:promptId{.+}", "putApiPromptsById")
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
    const { promptId: id, tags, ...data } = input;

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

  .delete("/api/prompts/:promptId{.+}", "deleteApiPromptsById")
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
    logger.info({ projectId: scope.id, promptId: input.promptId }, "Deleting prompt");

    const result = await app.deletePrompt({
      idOrHandle: input.promptId,
      projectId: scope.id,
      organizationId: project.organizationId,
    });

    logger.info(
      { projectId: scope.id, promptId: input.promptId, success: result.success },
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

  const refetched = await app.findByIdOrHandle({
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
