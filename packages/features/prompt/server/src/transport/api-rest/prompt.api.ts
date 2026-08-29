/**
 * The prompts REST family: a project's prompts, their versions and the tags
 * that point at them.
 *
 * Moved out of the application unchanged (ADR-128): the routes, the wire
 * schemas, the OpenAPI declarations and the three refusal mappers below are
 * exactly what `/api/prompts` published before, and the process's capabilities
 * that used to be read off the Hono context now arrive as ports.
 *
 * ## Why the raw service and not {@link PromptApp}
 *
 * `/api/prompts` authenticates a project API key, whose `apiKeyUserId` is
 * OPTIONAL — a service key acts as nobody. The application's write operations
 * stamp `authorId` from their caller, and `authorId` is a real foreign key to
 * User, so there is no valid author to stamp for a service credential. The
 * narrow service surface is what the credential can honestly reach; the
 * application stays the browser's door.
 */
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  conflictResponses,
  type PlatformUrlBuilder,
  type RouteResponse,
  type SecuredApp,
  successSchema,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { PromptScope } from "@langwatch/prisma-client/generated";
import {
  commitMessageSchema,
  getLatestConfigVersionSchema,
  handleSchema,
  inputsSchema,
  messageSchema,
  modelNameSchema,
  outputsSchema,
  parsePromptShorthand,
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
  runtimeParametersSchema,
  schemaVersionSchema,
  scopeSchema,
  ShorthandParseError,
  SystemPromptConflictError,
  SystemPromptRequiredError,
  versionSchema,
} from "@langwatch/prompt-contract";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z, type ZodSchema } from "zod";

import type { PromptApp } from "#app/prompt.app";

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
  scope: scopeSchema.optional().default(PromptScope.PROJECT),
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

export const updatePromptInputSchema = createPromptInputSchema
  .omit({
    scope: true,
    handle: true,
  })
  .merge(
    z.strictObject({
      // commitMessage is required for updates (creates new version)
      commitMessage: commitMessageSchema,
      // Scope is optional, but on the update we don't want to set the default
      scope: scopeSchema.optional(),
      handle: handleSchema.optional(),
    }),
  );

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
  scope: z.nativeEnum(PromptScope),
  name: z.string(),
  updatedAt: z.date(),
  projectId: z.string(),
  organizationId: z.string(),
});

/**
 * Tag association for a prompt version.
 * `versionId` is the version this tag currently points to —
 * included so callers can distinguish whether the tag points
 * to the prompt/version they're looking at.
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
export const apiResponsePromptWithVersionDataSchema = apiResponsePromptSchemaBase.merge(
  apiResponseVersionOutputSchema.omit({
    configId: true,
  }),
);

export type ApiResponsePrompt = z.infer<typeof apiResponsePromptWithVersionDataSchema>;

// ── the process's capabilities ───────────────────────────────────────────────

/**
 * The prompt reads and writes this family makes.
 *
 * The raw service rather than {@link PromptApp}: see the module comment — a
 * project API key may act as nobody, and the application's writes stamp an
 * `authorId` that is a foreign key to a real user.
 */
export type PromptRestService = PromptApp["promptService"];

/** What this family dispatches through that the prompt feature does not own. */
export interface PromptRestPorts {
  /**
   * Organization resolution, applied per route after the access chain has
   * authenticated the caller and set `project`.
   */
  organizationMiddleware: MiddlewareHandler;
  /** Deep links back into the product, built from the deployment's origin. */
  platformUrl: PlatformUrlBuilder;
  /**
   * The nurturing trail a first prompt leaves. Fired and forgotten: it is the
   * process's product-analytics concern, not the write's.
   */
  afterPromptCreated(input: { projectId: string; userId?: string | null }): void;
  /**
   * The columns a database unique-constraint violation names, or an empty list
   * when the failure is not one. Duck-typed against the driver's error shapes,
   * which is a fact about the process's database client rather than about
   * prompts.
   */
  uniqueConstraintTargets(error: unknown): string[];
}

// ── OpenAPI + refusal helpers ────────────────────────────────────────────────


/**
 * Builds a standard success response object for OpenAPI route definitions.
 *
 * This utility creates a consistent response structure for successful API operations,
 * converting a Zod schema into the OpenAPI response format expected by hono-openapi.
 *
 * @param zodSchema - The Zod schema that defines the shape of the response data
 * @returns A RouteResponse object with standardized success structure
 * @throws Error if zodSchema is not provided
 *
 * @example
 * ```typescript
 * const userSchema = z.object({ id: z.string(), name: z.string() });
 * const response = buildStandardSuccessResponse(userSchema);
 * // Returns: { description: "Success", content: { "application/json": { schema: ... } } }
 * ```
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
 * Handles a conflict error by throwing a 409 error with a message
 * indicating that the prompt handle already exists for the given scope.
 * If the error is not a conflict error, it will be re-thrown, it does nothing.
 *
 * @param ports - The process's capabilities; the constraint decoder is its own
 * @param error - The error to handle
 * @returns void
 */
export const handlePossibleConflictError = (
  ports: PromptRestPorts,
  error: unknown,
  scope: PromptScope = PromptScope.PROJECT,
) => {
  if (ports.uniqueConstraintTargets(error).some((t) => t.includes("handle"))) {
    throw new HTTPException(409, {
      message: `Prompt handle already exists for scope ${scope}`,
      cause: error,
    });
  }
};

/**
 * Maps system-prompt HandledErrors thrown by the prompt service to Hono HTTP
 * exceptions with the correct status code.
 *
 *   - {@link SystemPromptConflictError} → 409 Conflict
 *     (both top-level `prompt` and a system message supplied)
 *   - {@link SystemPromptRequiredError} → 400 Bad Request
 *     (neither supplied — added in #3196)
 *
 * Any other error type is re-thrown unchanged so the global handler can deal
 * with it. The error's own `message` is forwarded as the response body, since
 * both HandledErrors carry user-facing copy.
 *
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

/** What this family's own per-route organization middleware resolves. */
export type PromptOrganizationVariables = { organization: Readonly<{ id: string }> };

/**
 * The context variables this family reads: what the process's project
 * authentication sets, plus the organization resolved per route.
 */
export type PromptAppVariables = AppRestProjectVariables & PromptOrganizationVariables;

/**
 * REST for a project's prompts, built against one process's security.
 */
export function createPromptsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  prompts: () => PromptRestService;
  ports: PromptRestPorts;
}): SecuredApp<{ Variables: PromptAppVariables }> {
  const secured = options.security.createProjectApp<PromptOrganizationVariables>({
    basePath: "/api/prompts",
  });
  registerPromptRoutes(secured, options.prompts, options.ports);
  return secured;
}

export function registerPromptRoutes(
  secured: SecuredApp<{ Variables: PromptAppVariables }>,
  prompts: () => PromptRestService,
  ports: PromptRestPorts,
): void {
  // Organization resolution runs after the access chain, which authenticates
  // and sets `project`. The Prompt service is already process-owned on App.

  // Get all prompts
  secured.access(requires("prompts:view")).get(
    "/",
    ports.organizationMiddleware,
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
      const service = prompts();
      const project = c.get("project");
      const organization = c.get("organization");

      logger.info({ projectId: project.id }, "Getting all prompts for project");

      const configs: ApiResponsePrompt[] = await service.getAllPrompts({
        projectId: project.id,
        organizationId: organization.id,
        version: "latest",
      });

      return c.json(
        apiResponsePromptWithVersionDataSchema
          .array()
          .parse(configs)
          .map((p) => ({
            ...p,
            platformUrl: ports.platformUrl({
              projectSlug: project.slug,
              path: `/prompts`,
            }),
          })),
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

  // Assigning a tag changes an existing prompt; it creates nothing the caller
  // `:manage`. Moving a tag is not editing a prompt — it repoints the release
  // pointer, and so decides which version the customer's live traffic resolves
  // to. That is a deployment, and it belongs with the grain that administers
  // the prompt rather than with the one that edits its text.
  secured.access(requires("prompts:manage")).put(
    "/:id{.+?}/tags/:tag",
    ports.organizationMiddleware,
    describeRoute({
      description:
        'Assign a tag (e.g. "production", "staging") to a specific prompt version',
      parameters: [
        {
          name: "tag",
          in: "path",
          description:
            'The tag to assign (e.g., "production", "staging", or a custom tag)',
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
      const service = prompts();
      const project = c.get("project");
      const organization = c.get("organization");
      const { id, tag } = c.req.param();
      const { versionId } = c.req.valid("json");

      logger.info(
        { projectId: project.id, promptId: id, tag, versionId },
        "Assigning tag to prompt version",
      );

      try {
        const config = await service.tryGetPromptByIdOrHandle({
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
        if (error instanceof PromptTagValidationError) {
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
  secured.access(requires("prompts:view")).get(
    "/tags",
    ports.organizationMiddleware,
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
      const tags = await prompts().listTags({ organizationId: organization.id });

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
  secured.access(requires("prompts:manage")).post(
    "/tags",
    ports.organizationMiddleware,
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
      try {
        const tag = await prompts().createTag({
          organizationId: organization.id,
          name,
        });

        logger.info(
          { organizationId: organization.id, name },
          "Custom prompt tag created via REST",
        );

        return c.json({ id: tag.id, name: tag.name, createdAt: tag.createdAt }, 201);
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
  secured.access(requires("prompts:manage")).put(
    "/tags/:tag",
    ports.organizationMiddleware,
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
      try {
        const tag = await prompts().renameTag({
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
  secured.access(requires("prompts:manage")).delete(
    "/tags/:tag",
    ports.organizationMiddleware,
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
      try {
        const tag = await prompts().tryDeleteTagByName({
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
  secured.access(requires("prompts:view")).get(
    "/:id{.+?}/versions",
    ports.organizationMiddleware,
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
      const service = prompts();
      const project = c.get("project");
      const organization = c.get("organization");
      const { id } = c.req.param();

      logger.info({ projectId: project.id, promptId: id }, "Getting versions for prompt");

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
        apiResponsePromptWithVersionDataSchema
          .array()
          .parse(versions)
          .map((v) => ({
            ...v,
            platformUrl: ports.platformUrl({
              projectSlug: project.slug,
              path: `/prompts`,
            }),
          })),
      );
    },
  );

  // Restore (rollback to) a specific version — a new version of a prompt that
  // already exists, i.e. an update of that prompt.
  secured.access(requires("prompts:update")).post(
    "/:id{.+?}/versions/:versionId/restore",
    ports.organizationMiddleware,
    describeRoute({
      description:
        "Restore a prompt to a previous version. Creates a new version with the same config data as the specified version.",
      responses: {
        ...baseResponses,
        200: buildStandardSuccessResponse(apiResponsePromptWithVersionDataSchema),
        404: {
          description: "Prompt or version not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const service = prompts();
      const project = c.get("project");
      const organization = c.get("organization");
      const { id, versionId } = c.req.param();

      logger.info(
        { projectId: project.id, promptId: id, versionId },
        "Restoring prompt version",
      );

      // A missing prompt/version arrives as a `NotFoundError`, which is a
      // `HandledError` — the app's `onError` serialises it into the standard
      // body (code `prompt_not_found`, 404, trace ids). Hand-rolling
      // `c.json({ error: message }, 404)` here shipped untyped prose instead,
      // which nothing downstream could branch on.
      const restored = await service.restoreVersion({
        versionId,
        projectId: project.id,
        organizationId: organization.id,
      });

      logger.info(
        { projectId: project.id, promptId: id, versionId },
        "Successfully restored prompt version",
      );

      return c.json({
        ...apiResponsePromptWithVersionDataSchema.parse(restored),
        platformUrl: ports.platformUrl({
          projectSlug: project.slug,
          path: `/prompts`,
        }),
      });
    },
  );

  // Get prompt by ID
  secured.access(requires("prompts:view")).get(
    "/:id{.+}",
    ports.organizationMiddleware,
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
            'Fetch the version pointed to by this tag (e.g., "production", "staging"). ' +
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
      const service = prompts();
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

        // Reject conflicting shorthand + query param.
        // hadSuffix is true even for "latest" (which normalizes away), so
        // "foo:latest?tag=production" is correctly rejected.
        if (shorthand.hadSuffix && (queryTag || queryVersion)) {
          throw new HTTPException(422, {
            message: `Conflict: shorthand syntax in path cannot be combined with tag or version query parameters. Use one or the other, not both.`,
          });
        }

        const version = shorthand.version ?? queryVersion;
        const tag = shorthand.tag ?? queryTag;

        logger.info(
          { projectId: project.id, id: shorthand.slug, version, tag },
          "Getting prompt",
        );

        const config = await service.tryGetPromptByIdOrHandle({
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

        return c.json({
          ...apiResponsePromptWithVersionDataSchema.parse(config),
          platformUrl: ports.platformUrl({
            projectSlug: project.slug,
            path: `/prompts`,
          }),
        });
      } catch (error: unknown) {
        if (error instanceof HTTPException) {
          throw error;
        }
        if (error instanceof PromptTagValidationError) {
          throw new HTTPException(422, {
            message: error.message,
          });
        }
        // `NotFoundError` is a `HandledError` and is left to propagate: the
        // app's `onError` serialises it with its `prompt_not_found` code, and
        // re-wrapping it as an `HTTPException` would flatten that back down to
        // a bare status + prose.
        if (error instanceof ShorthandParseError) {
          throw new HTTPException(422, {
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  // Create prompt with initial version. Asks for `prompts:create`; `:manage`
  // still implies it, so no existing caller changes, and a viewer holding only
  // `prompts:view` is declined exactly as before.
  secured.access(requires("prompts:create")).post(
    "/",
    ports.organizationMiddleware,
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
      const service = prompts();
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

        let responseConfig: ApiResponsePrompt = newConfig;

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

          const refetched = await service.tryGetPromptByIdOrHandle({
            idOrHandle: newConfig.id,
            projectId: project.id,
            organizationId: organization.id,
          });
          if (refetched) {
            responseConfig = refetched;
          }
        }

        ports.afterPromptCreated({ projectId: project.id });

        return c.json({
          ...apiResponsePromptWithVersionDataSchema.parse(responseConfig),
          platformUrl: ports.platformUrl({
            projectSlug: project.slug,
            path: `/prompts`,
          }),
        });
      } catch (error: any) {
        logger.error({ projectId: project.id, error }, "Error creating prompt");
        if (error instanceof PromptTagValidationError) {
          throw new HTTPException(422, {
            message: error.message,
          });
        }
        handlePossibleConflictError(ports, error, data.scope);

        // Re-throw other errors to be handled by the error middleware
        throw error;
      }
    },
  );

  // Sync endpoint for upsert operations
  secured.access(requires("prompts:manage")).post(
    "/:id{.+?}/sync",
    ports.organizationMiddleware,
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
        parameters: z.record(z.string(), z.unknown()).optional(),
        localVersion: versionSchema.optional(),
        commitMessage: commitMessageSchema.optional(),
      }),
    ),
    async (c) => {
      const service = prompts();
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
          parameters: data.parameters,
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
          ports.afterPromptCreated({ projectId: project.id });
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

        if (error instanceof PromptTagValidationError) {
          throw new HTTPException(422, {
            message: error.message,
          });
        }

        // Translate Prisma unique-constraint violations on handle into a
        // readable 409 instead of bubbling up as "Internal server error".
        handlePossibleConflictError(ports, error);

        // Re-throw other errors to be handled by the error middleware
        throw error;
      }
    },
  );

  // Update prompt
  secured.access(requires("prompts:update")).put(
    "/:id{.+}",
    ports.organizationMiddleware,
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
      const service = prompts();
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

        let responseConfig: ApiResponsePrompt = updatedConfig;

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
            {
              projectId,
              promptId: id,
              tags,
              versionId: updatedConfig.versionId,
            },
            "Assigned tags to updated version",
          );

          const refetched = await service.tryGetPromptByIdOrHandle({
            idOrHandle: updatedConfig.id,
            projectId,
            organizationId: organization.id,
          });
          if (refetched) {
            responseConfig = refetched;
          }
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

        return c.json({
          ...apiResponsePromptWithVersionDataSchema.parse(responseConfig),
          platformUrl: ports.platformUrl({
            projectSlug: project.slug,
            path: `/prompts`,
          }),
        });
      } catch (error: any) {
        logger.error({ projectId, promptId: id, error }, "Error updating prompt");
        if (error instanceof PromptTagValidationError) {
          throw new HTTPException(422, {
            message: error.message,
          });
        }
        handlePossibleConflictError(ports, error, data.scope);
        handleSystemPromptHandledErrors(error);

        // Re-throw other errors to be handled by the error middleware
        throw error;
      }
    },
  );
  // Delete prompt
  secured.access(requires("prompts:manage")).delete(
    "/:id{.+}",
    ports.organizationMiddleware,
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
      const service = prompts();
      const project = c.get("project");
      const organization = c.get("organization");
      const { id } = c.req.param();

      logger.info({ projectId: project.id, promptId: id }, "Deleting prompt");

      const result = await service.deletePrompt({
        idOrHandle: id,
        projectId: project.id,
        organizationId: organization.id,
      });

      logger.info(
        { projectId: project.id, promptId: id, success: result.success },
        "Successfully deleted prompt",
      );

      return c.json(successSchema.parse(result));
    },
  );
}
