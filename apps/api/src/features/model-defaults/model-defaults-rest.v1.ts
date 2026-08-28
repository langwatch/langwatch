import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  anyAuthenticated,
  type AppRestProjectVariables,
  baseResponses,
  patchZodOpenapi,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";
import {
  apiResponseConfigCreatedSchema,
  apiResponseModelDefaultsSchema,
  createModelDefaultConfigInputSchema,
  updateModelDefaultConfigInputSchema,
} from "./model-defaults-rest.schemas";

const logger = createLogger("langwatch:api:model-defaults");

patchZodOpenapi();

/**
 * Uniform error mapping for the default-model write handlers: a typed
 * HTTPException (e.g. the 404 orphan-config ownership backstop) and any
 * HandledError (the app's onError serialises those with their own status
 * and code) pass through untouched, any other Error collapses to a 400,
 * and non-Error throwables re-throw as-is.
 */
function rethrowModelDefaultsWriteError(err: unknown): never {
  if (err instanceof HTTPException) throw err;
  if (HandledError.isHandled(err)) throw err;
  if (err instanceof Error) {
    throw new HTTPException(400, { message: err.message });
  }
  throw err;
}

export function registerModelDefaultsRoutes(
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>,
  modelProviders: () => ModelProviderService,
): void {
  // GET /api/model-defaults — snapshot for the current project (read scope).
  secured.access(requires("project:view")).get(
    "/",
    describeRoute({
      description:
        "Snapshot of the default-model cascade for this project: effective resolution per role, plus the configs the caller can read.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(apiResponseModelDefaultsSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const userId = c.get("apiKeyUserId");
      const snapshot = await modelProviders().getDefaultSnapshot({
        projectId: project.id,
        actorId: userId,
      });

      return c.json(
        apiResponseModelDefaultsSchema.parse({
          scope: {
            projectId: snapshot.projectId,
            teamId: snapshot.teamId,
            organizationId: snapshot.organizationId,
            organizationName: snapshot.organizationName,
          },
          effective: Object.fromEntries(
            ["DEFAULT", "FAST", "EMBEDDINGS"].map((role) => [
              role,
              snapshot.effective[role] ?? null,
            ]),
          ),
          configs: snapshot.configs.map((c) => ({
            id: c.id,
            config: c.config,
            scopes: c.scopes,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
          })),
        }),
      );
    },
  );

  // POST /api/model-defaults — create a new config. Authorization is
  // data-dependent: the canonical service gates every target scope
  // (the Hono analogue of tRPC's authorizeInResolver), so the route policy is
  // "any authenticated caller" and the real check happens below.
  secured.access(anyAuthenticated()).post(
    "/",
    describeRoute({
      description:
        "Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST, LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(apiResponseConfigCreatedSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createModelDefaultConfigInputSchema),
    async (c) => {
      const project = c.get("project");
      const userId = c.get("apiKeyUserId");
      const body = c.req.valid("json");

      try {
        if (!userId)
          throw new HTTPException(401, {
            message: "A user-bound credential is required for default-model writes",
          });
        const saved = await modelProviders().saveDefaultConfig({
          config: body.config,
          scopes: body.scopes,
          authorId: userId ?? null,
          actorId: userId,
        });
        const id = saved.id;
        logger.info(
          { projectId: project.id, configId: id, userId },
          "Created default-model config",
        );
        return c.json(apiResponseConfigCreatedSchema.parse({ id }));
      } catch (err) {
        rethrowModelDefaultsWriteError(err);
      }
    },
  );

  // PUT /api/model-defaults/:id — update an existing config. Same
  // data-dependent authorization as POST plus an ownership backstop below.
  secured.access(anyAuthenticated()).put(
    "/:id",
    describeRoute({
      description:
        "Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the config.",
      responses: {
        ...baseResponses,
        204: { description: "Updated" },
      },
    }),
    zValidator("json", updateModelDefaultConfigInputSchema),
    async (c) => {
      const project = c.get("project");
      const userId = c.get("apiKeyUserId");
      const { id } = c.req.param();
      const body = c.req.valid("json");

      try {
        if (!userId)
          throw new HTTPException(401, {
            message: "A user-bound credential is required for default-model writes",
          });
        const saved = await modelProviders().saveDefaultConfig({
          id,
          config: body.config,
          scopes: body.scopes,
          authorId: userId ?? null,
          actorId: userId,
        });
        if (!saved) throw new HTTPException(404, { message: "Config not found" });
        logger.info(
          { projectId: project.id, configId: id, userId },
          "Updated default-model config",
        );
        return c.body(null, 204);
      } catch (err) {
        rethrowModelDefaultsWriteError(err);
      }
    },
  );

  // DELETE /api/model-defaults/:id — delete a config.
  secured.access(anyAuthenticated()).delete(
    "/:id",
    describeRoute({
      description: "Delete a default-model config. Scope attachments cascade.",
      responses: {
        ...baseResponses,
        204: { description: "Deleted" },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const userId = c.get("apiKeyUserId");
      const { id } = c.req.param();

      try {
        if (!userId)
          throw new HTTPException(401, {
            message: "A user-bound credential is required for default-model writes",
          });
        await modelProviders().deleteDefaultConfig({
          id,
          actorId: userId,
        });
        logger.info(
          { projectId: project.id, configId: id, userId },
          "Deleted default-model config",
        );
        return c.body(null, 204);
      } catch (err) {
        rethrowModelDefaultsWriteError(err);
      }
    },
  );
}
