import { createLogger } from "@langwatch/observability";
import { restVersionSelectorMiddleware, RestVersionSelector } from "@langwatch/api";
import { HandledError } from "@langwatch/handled-error";
import {
  SecretDuplicateError,
  SecretLimitReachedError,
  SecretNotFoundError,
  SecretReservedNameError,
  secretPublicCreateInputSchema,
  secretPublicRest,
  secretPublicUpdateInputSchema,
  toSecretPublic,
} from "@langwatch/secret-contract";
import { describeRoute, resolver } from "hono-openapi";
import { type Context, type MiddlewareHandler } from "hono";
import { handleError } from "~/app/api/middleware/error-handler";
import { baseResponses } from "~/app/api/shared/base-responses";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { createProjectApp, requires } from "~/server/api/security";
import { hiddenValidator } from "~/server/api/validation";

const logger = createLogger("langwatch:api:secrets");
const LEGACY_SECRET_API_NOTICE =
  "The unversioned REST secrets API is deprecated; use the modern /api/v1/secret REST API.";
const legacyRestVersionSelector = RestVersionSelector.create({
  versions: ["v1"],
  latestVersion: "v1",
});

function legacySecretActorId(context: Context): string {
  const apiKeyUserId: unknown = context.get("apiKeyUserId");
  if (typeof apiKeyUserId === "string" && apiKeyUserId.length > 0) {
    return apiKeyUserId;
  }
  throw new HandledError(
    "authenticated_actor_required",
    "This operation requires a credential bound to a user",
    { httpStatus: 403 },
  );
}

const legacyDeprecationWarning: MiddlewareHandler = async (context, next) => {
  context.header("Deprecation", "true");
  context.header("Warning", `299 - "${LEGACY_SECRET_API_NOTICE}"`);
  context.header("X-API-Deprecation-Notice", LEGACY_SECRET_API_NOTICE);
  logger.warn(
    { method: context.req.method, path: context.req.path },
    "Deprecated secrets REST API called",
  );
  await next();
};

const legacy = createProjectApp({ basePath: "/api/secrets" });
legacy.use(legacyDeprecationWarning);
legacy.use(restVersionSelectorMiddleware({ selector: legacyRestVersionSelector }));
legacy.hono.onError((error, context) => {
  if (error instanceof SecretNotFoundError) {
    return context.json({ error: "Secret not found" }, 404);
  }
  if (error instanceof SecretDuplicateError) {
    return context.json({ error: error.message }, 409);
  }
  if (error instanceof SecretReservedNameError || error instanceof SecretLimitReachedError) {
    return context.json({ error: error.message }, 422);
  }
  return handleError(error, context);
});

legacy.access(requires("secrets:view")).get(
  "/",
  describeRoute({
    operationId: "getApiSecrets",
    description: "List all secrets for the project (values are never returned)",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: { "application/json": { schema: resolver(secretPublicRest.list.output) } },
      },
    },
  }),
  async (context) => {
    const project = context.get("project");
    return context.json(
      (await context.app.secrets.list({ projectId: project.id })).map(toSecretPublic),
    );
  },
);

legacy.access(requires("secrets:view")).get(
  "/:id",
  describeRoute({
    operationId: "getApiSecretsById",
    description: "Get a secret by its ID (value is never returned)",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: { "application/json": { schema: resolver(secretPublicRest.get.output) } },
      },
      404: {
        description: "Secret not found",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  }),
  async (context) => {
    const project = context.get("project");
    return context.json(
      toSecretPublic(
        await context.app.secrets.get({ projectId: project.id, id: context.req.param("id") }),
      ),
    );
  },
);

legacy.access(requires("secrets:manage")).post(
  "/",
  describeRoute({
    operationId: "postApiSecrets",
    description: "Create a new project secret. The value is encrypted at rest and never returned.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: resolver(secretPublicCreateInputSchema.omit({ projectId: true })),
          },
        },
      },
    },
    responses: {
      ...baseResponses,
      201: {
        description: "Secret created",
        content: { "application/json": { schema: resolver(secretPublicRest.create.output) } },
      },
      409: {
        description: "Secret with this name already exists",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  }),
  hiddenValidator("json", secretPublicCreateInputSchema.omit({ projectId: true })),
  async (context) => {
    const project = context.get("project");
    const input = context.req.valid("json");
    return context.json(
      toSecretPublic(
        await context.app.secrets.create({
          projectId: project.id,
          actorId: legacySecretActorId(context),
          ...input,
        }),
      ),
      201,
    );
  },
);

legacy.access(requires("secrets:manage")).put(
  "/:id",
  describeRoute({
    operationId: "putApiSecretsById",
    description: "Update a secret's value",
    request: {
      body: {
        content: {
          "application/json": {
            schema: resolver(secretPublicUpdateInputSchema.omit({ id: true, projectId: true })),
          },
        },
      },
    },
    responses: {
      ...baseResponses,
      200: {
        description: "Secret updated",
        content: { "application/json": { schema: resolver(secretPublicRest.update.output) } },
      },
      404: {
        description: "Secret not found",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  }),
  hiddenValidator("json", secretPublicUpdateInputSchema.omit({ id: true, projectId: true })),
  async (context) => {
    const project = context.get("project");
    return context.json(
      toSecretPublic(
        await context.app.secrets.update({
          projectId: project.id,
          id: context.req.param("id"),
          value: context.req.valid("json").value,
          actorId: legacySecretActorId(context),
        }),
      ),
    );
  },
);

legacy.access(requires("secrets:manage")).delete(
  "/:id",
  describeRoute({
    operationId: "deleteApiSecretsById",
    description: "Delete a secret",
    responses: {
      ...baseResponses,
      200: {
        description: "Secret deleted",
        content: { "application/json": { schema: resolver(secretPublicRest.delete.output) } },
      },
      404: {
        description: "Secret not found",
        content: { "application/json": { schema: resolver(badRequestSchema) } },
      },
    },
  }),
  async (context) => {
    const project = context.get("project");
    const id = context.req.param("id");
    await context.app.secrets.delete({ projectId: project.id, id });
    return context.json({ id, deleted: true });
  },
);

export const app = legacy.hono;
