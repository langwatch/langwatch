import { AuthenticatedActorRequiredError } from "@langwatch/api";
import { RestVersionSelector, restVersionSelectorMiddleware } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
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
import type { SecretApp } from "@langwatch/secret-server";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";

import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  requires,
  validator,
  type SecuredApp,
} from "../../app-rest";

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
  throw new AuthenticatedActorRequiredError();
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

/**
 * The deprecated unversioned secrets REST family, `/api/secrets`.
 *
 * It derives the project from the credential and publishes the flat legacy
 * error body, which is why it still exists alongside the modern
 * `/api/v1/secret` family: both are deployed and their payload and error
 * semantics differ. No secret VALUE is ever read back — `toSecretPublic` is
 * the one projection every response goes through.
 */
export function createSecretLegacyRestApp(options: {
  security: AppRestSecurity;
  secrets: () => SecretApp;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, secrets } = options;

  const legacy = security.createProjectApp({ basePath: "/api/secrets" });
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
    return security.legacyErrorHandler(error, context);
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
      return context.json((await secrets().list({ projectId: project.id })).map(toSecretPublic));
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
        toSecretPublic(await secrets().get({ projectId: project.id, id: context.req.param("id") })),
      );
    },
  );

  legacy.access(requires("secrets:manage")).post(
    "/",
    describeRoute({
      operationId: "postApiSecrets",
      description:
        "Create a new project secret. The value is encrypted at rest and never returned.",
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
    validator("json", secretPublicCreateInputSchema.omit({ projectId: true })),
    async (context) => {
      const project = context.get("project");
      const input = context.req.valid("json");
      return context.json(
        toSecretPublic(
          await secrets().create(
            { projectId: project.id, ...input },
            { id: legacySecretActorId(context) },
          ),
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
    validator("json", secretPublicUpdateInputSchema.omit({ id: true, projectId: true })),
    async (context) => {
      const project = context.get("project");
      return context.json(
        toSecretPublic(
          await secrets().update(
            {
              projectId: project.id,
              id: context.req.param("id"),
              value: context.req.valid("json").value,
            },
            { id: legacySecretActorId(context) },
          ),
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
      await secrets().delete({ projectId: project.id, id });
      return context.json({ id, deleted: true });
    },
  );

  return legacy;
}
