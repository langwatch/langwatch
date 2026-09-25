/**
 * The `/api/prompts` REST family: a project's prompts, their versions and
 * the tag catalogue those versions are labelled from. Literal addressing -
 * the `/:id{.+}` doors below would swallow a dated namespace segment.
 */
import {
  badRequestSchema,
  baseResponses,
  buildStandardSuccessResponse,
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
  PromptApi,
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
  renameTagInputSchema,
  promptWireSchema,
  syncInputSchema,
  tagDefinitionSchema,
  tagParamsSchema,
  updatePromptInputSchema,
} from "@langwatch/prompt-contract";
import { z } from "zod";

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
  .put("/api/prompts/:id{.+?}/tags/:tag", "putApiPromptsByIdTagsByTag")
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
    const result = await app.assignTagByAddress({
      idOrHandle: input.id,
      versionId: input.versionId,
      tag: input.tag,
      projectId: scope.id,
      organizationId: project.organizationId,
    });

    return {
      configId: result.configId,
      versionId: result.versionId,
      tag: result.promptTag.name,
      updatedAt: result.updatedAt,
    };
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
      201: { ...buildStandardSuccessResponse(tagDefinitionSchema), description: "Tag created" },
    },
  })
  .handle(async ({ app, input }, project) => {
    const tag = await app.createTagDefinition({
      organizationId: project.organizationId,
      name: input.name,
    });

    return { id: tag.id, name: tag.name, createdAt: tag.createdAt };
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
      200: { ...buildStandardSuccessResponse(tagDefinitionSchema), description: "Tag renamed" },
    },
  })
  .handle(async ({ app, input, scope }, project, credential) => {
    const tag = await app.renameTagDefinition({
      projectId: scope.id,
      organizationId: project.organizationId,
      oldName: input.tag,
      newName: input.name,
      by: credential,
    });

    return { id: tag.id, name: tag.name, createdAt: tag.createdAt };
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
    await app.deleteTagDefinition({
      projectId: scope.id,
      organizationId: project.organizationId,
      name: input.tag,
      by: credential,
    });
  })

  .get("/api/prompts/:id{.+?}/versions", "getApiPromptsByIdVersions")
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
  .post(
    "/api/prompts/:id{.+?}/versions/:versionId/restore",
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

  .get("/api/prompts/:id{.+}", "getApiPromptsById")
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
    // The two window parameters stay unrefused by their schema: a caller that
    // sends `version=abc` is answered by the conflict and shorthand rules.
    const config = await app.getByAddress({
      address: input.id,
      projectId: scope.id,
      organizationId: project.organizationId,
      ...(input.version === undefined ? {} : { version: input.version }),
      ...(input.tag === undefined ? {} : { tag: input.tag }),
    });

    return {
      ...apiResponsePromptWithVersionDataSchema.parse(config),
      platformUrl: project.promptsUrl,
    };
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
    const answered = await app.createWithTags({
      projectId: scope.id,
      organizationId: project.organizationId,
      ...input,
    });

    return {
      ...apiResponsePromptWithVersionDataSchema.parse(answered),
      platformUrl: project.promptsUrl,
    };
  })

  .post("/api/prompts/:id{.+?}/sync", "postApiPromptsByIdSync")
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
        ...buildStandardSuccessResponse(documentedSyncResultSchema),
        description: "Sync result",
      },
    },
  })
  .handle(async ({ app, input, scope }, project) =>
    app.syncAndAnnounce({
      idOrHandle: input.id,
      localConfigData: input.configData,
      localVersion: input.localVersion,
      projectId: scope.id,
      organizationId: project.organizationId,
      commitMessage: input.commitMessage,
      parameters: input.parameters,
    }),
  )

  .put("/api/prompts/:id{.+}", "putApiPromptsById")
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
    const answered = await app.updateWithTags({
      idOrHandle: id,
      projectId: scope.id,
      organizationId: project.organizationId,
      data,
      tags,
    });

    return {
      ...apiResponsePromptWithVersionDataSchema.parse(answered),
      platformUrl: project.promptsUrl,
    };
  })

  .delete("/api/prompts/:id{.+}", "deleteApiPromptsById")
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
