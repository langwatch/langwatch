import { createLogger } from "@langwatch/observability";
import { AuthenticatedActorRequiredError } from "@langwatch/api";
import {
  SecretLimitReachedError,
  SecretNotFoundError,
  secretPublicCreateInputSchema,
  secretPublicUpdateInputSchema,
  SecretDuplicateError,
  SecretReservedNameError,
  toSecretPublic,
} from "@langwatch/secret-contract";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { AppSecretApi } from "~/runtime/app/features/secret";
import { handleError } from "~/app/api/middleware/error-handler";
import { createProjectApiService } from "~/server/api/project-service";
import { createProjectApp, requires } from "~/server/api/security";
import { hiddenValidator } from "~/server/api/validation";

const logger = createLogger("langwatch:api:secrets");
const LEGACY_SECRET_API_NOTICE =
  "The unversioned REST secrets API is deprecated; use /api/secrets/latest/secrets.* RPC operations.";

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

function legacySecretActorId(context: Context): string {
  const apiKeyUserId: unknown = context.get("apiKeyUserId");
  if (typeof apiKeyUserId === "string" && apiKeyUserId.length > 0) {
    return apiKeyUserId;
  }
  throw new AuthenticatedActorRequiredError();
}

const legacy = createProjectApp({ basePath: "/api/secrets" });
legacy.use(legacyDeprecationWarning);
legacy.hono.onError((error, context) => {
  if (error instanceof SecretNotFoundError) {
    return context.json({ error: "Secret not found" }, 404);
  }
  if (error instanceof SecretDuplicateError) {
    return context.json({ error: error.message }, 409);
  }
  if (
    error instanceof SecretReservedNameError ||
    error instanceof SecretLimitReachedError
  ) {
    return context.json({ error: error.message }, 422);
  }
  return handleError(error, context);
});

legacy.access(requires("secrets:view")).get("/", async (context) => {
  const project = context.get("project");
  const secrets = await context.app.secrets.list({
    projectId: project.id,
  });
  return context.json(secrets.map(toSecretPublic));
});

legacy.access(requires("secrets:view")).get("/:id", async (context) => {
  const project = context.get("project");
  const secret = await context.app.secrets.get({
    projectId: project.id,
    id: context.req.param("id"),
  });
  return context.json(toSecretPublic(secret));
});

legacy
  .access(requires("secrets:manage"))
  .post(
    "/",
    hiddenValidator("json", secretPublicCreateInputSchema.omit({ projectId: true })),
    async (context) => {
      const project = context.get("project");
      const input = context.req.valid("json");
      const secret = await context.app.secrets.create({
        projectId: project.id,
        actorId: legacySecretActorId(context),
        ...input,
      });
      return context.json(toSecretPublic(secret), 201);
    },
  );

legacy
  .access(requires("secrets:manage"))
  .put(
    "/:id",
    hiddenValidator(
      "json",
      secretPublicUpdateInputSchema.omit({ id: true, projectId: true }),
    ),
    async (context) => {
      const project = context.get("project");
      const secret = await context.app.secrets.update({
        projectId: project.id,
        id: context.req.param("id"),
        value: context.req.valid("json").value,
        actorId: legacySecretActorId(context),
      });
      return context.json(toSecretPublic(secret));
    },
  );

legacy.access(requires("secrets:manage")).delete("/:id", async (context) => {
  const project = context.get("project");
  const id = context.req.param("id");
  await context.app.secrets.delete({ projectId: project.id, id });
  return context.json({ id, deleted: true });
});

const rpcBuilder = createProjectApiService({
  name: "secrets",
  basePath: "/api/secrets",
  openapiUrl: "/api/openapi.json",
});
const rpc = AppSecretApi.create().install(rpcBuilder).build();

export const app = new Hono().route("/", legacy.hono).route("/", rpc);
