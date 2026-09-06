import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  ModelDefaultUserKeyRequiredError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { apiKeyPermission, requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  baseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  projectOf,
  type ProjectScopedContext,
} from "@langwatch/api/rest";
import {
  apiResponseConfigCreatedSchema,
  apiResponseModelDefaultsSchema,
  createModelDefaultConfigInputSchema,
  updateModelDefaultConfigInputSchema,
} from "../../rules/model-defaults-schemas.rules.ts";

const logger = createLogger("langwatch:api:model-defaults");

/** Ceiling on the project a key resolved to — the service checks scopes against the owning user. */
const MODEL_DEFAULTS_WRITE_PERMISSION = "project:manage" as const;

const configIdParamsSchema = z.object({ id: z.string().min(1) });

/** HTTPException and HandledError pass through untouched; any other Error collapses to a 400. */
function rethrowModelDefaultsWriteError(err: unknown): never {
  if (err instanceof HTTPException) throw err;
  if (HandledError.isHandled(err)) throw err;
  if (err instanceof Error) {
    throw new HTTPException(400, { message: err.message });
  }
  throw err;
}

/**
 * REST CRUD for ModelDefaultConfig rows, for CLI/external API users. Mirrors
 * the tRPC surface over the same service so behaviour stays consistent.
 */
export function createModelDefaultsRestApp(options: {
  security: AppRestSecurity;
  /** Lazy: mounting a family must not force its services to construct (OpenAPI needs none). */
  modelProviders: () => ModelProviderService;
}): MountableRestApp {
  const { security, modelProviders } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "model-defaults",
    basePath: "/api/model-defaults",
    errorEnvelope: "legacy",
  });

  type ModelDefaultsContext = ProjectScopedContext<EndpointVariables>;

  const projectId = (c: ModelDefaultsContext): string => projectOf(c).id;
  const actorId = (c: ModelDefaultsContext): string | undefined => c.get("apiKeyUserId");

  const snapshotHandler = async (c: ModelDefaultsContext) => {
    const snapshot = await modelProviders().getDefaultSnapshot({
      projectId: projectId(c),
      actorId: actorId(c),
    });

    return {
      scope: {
        projectId: snapshot.projectId,
        teamId: snapshot.teamId,
        organizationId: snapshot.organizationId,
        organizationName: snapshot.organizationName,
      },
      effective: Object.fromEntries(
        ["DEFAULT", "FAST", "EMBEDDINGS"].map((role) => [role, snapshot.effective[role] ?? null]),
      ),
      configs: snapshot.configs.map((config) => ({
        id: config.id,
        config: config.config,
        scopes: config.scopes,
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      })),
    };
  };

  const createHandler = async (
    c: ModelDefaultsContext,
    input: z.infer<typeof createModelDefaultConfigInputSchema>,
  ) => {
    const userId = actorId(c);
    try {
      if (!userId) throw new ModelDefaultUserKeyRequiredError();
      const saved = await modelProviders().saveDefaultConfig({
        config: input.config,
        scopes: input.scopes,
        authorId: userId ?? null,
        actorId: userId,
      });
      const id = saved.id;
      logger.info(
        { projectId: projectId(c), configId: id, userId },
        "Created default-model config",
      );
      return { id };
    } catch (err) {
      rethrowModelDefaultsWriteError(err);
    }
  };

  const updateHandler = async (
    c: ModelDefaultsContext,
    input: z.infer<typeof configIdParamsSchema> &
      z.infer<typeof updateModelDefaultConfigInputSchema>,
  ) => {
    const userId = actorId(c);
    try {
      if (!userId) throw new ModelDefaultUserKeyRequiredError();
      const saved = await modelProviders().saveDefaultConfig({
        id: input.id,
        config: input.config,
        scopes: input.scopes,
        authorId: userId ?? null,
        actorId: userId,
      });
      if (!saved) throw new HTTPException(404, { message: "Config not found" });
      logger.info(
        { projectId: projectId(c), configId: input.id, userId },
        "Updated default-model config",
      );
    } catch (err) {
      rethrowModelDefaultsWriteError(err);
    }
  };

  const deleteHandler = async (
    c: ModelDefaultsContext,
    input: z.infer<typeof configIdParamsSchema>,
  ) => {
    const userId = actorId(c);
    try {
      if (!userId) throw new ModelDefaultUserKeyRequiredError();
      await modelProviders().deleteDefaultConfig({ id: input.id, actorId: userId });
      logger.info(
        { projectId: projectId(c), configId: input.id, userId },
        "Deleted default-model config",
      );
    } catch (err) {
      rethrowModelDefaultsWriteError(err);
    }
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, snapshotHandler, (b) =>
        policy(requires("project:view"))(b).withOutput(apiResponseModelDefaultsSchema).withDocs({
          description:
            "Snapshot of the default-model cascade for this project: effective resolution per role, plus the configs the caller can read.",
          responses: baseResponses,
        }),
      )
      // The canonical service gates every target scope against the KEY OWNER,
      // so the route declares the API-key ceiling on top: without it a
      // deliberately narrow key wrote the organization's defaults with its
      // owner's grants.
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(apiKeyPermission(MODEL_DEFAULTS_WRITE_PERMISSION))(b)
          .withInput(createModelDefaultConfigInputSchema)
          .withOutput(apiResponseConfigCreatedSchema)
          .withDocs({
            description:
              "Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST, LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.",
            responses: baseResponses,
          }),
      )
      .registerRoute("put", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(apiKeyPermission(MODEL_DEFAULTS_WRITE_PERMISSION))(b)
          .withParams(configIdParamsSchema)
          .withInput(updateModelDefaultConfigInputSchema)
          .withOutput(z.void())
          .withDocs({
            description:
              "Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the config.",
            responses: { ...baseResponses, 204: { description: "Updated" } },
          }),
      )
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteHandler, (b) =>
        policy(apiKeyPermission(MODEL_DEFAULTS_WRITE_PERMISSION))(b)
          .withParams(configIdParamsSchema)
          .withOutput(z.void())
          .withDocs({
            description: "Delete a default-model config. Scope attachments cascade.",
            responses: { ...baseResponses, 204: { description: "Deleted" } },
          }),
      )
      .build()
  );
}
