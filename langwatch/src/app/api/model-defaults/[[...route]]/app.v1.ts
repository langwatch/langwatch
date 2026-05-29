import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import {
  anyAuthenticated,
  requires,
  type SecuredApp,
} from "~/server/api/security";
import type { Session } from "~/server/auth";
import { prisma } from "~/server/db";
import { getDefaultModelsSnapshot } from "~/server/modelProviders/modelDefaults.read";
import {
  assertCanWriteScope,
  createConfig,
  deleteConfig,
  getScopeAttachmentsForConfig,
  updateConfig,
} from "~/server/modelProviders/modelDefaults.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";

import type { AuthMiddlewareVariables } from "../../middleware/auth";
import { baseResponses } from "../../shared/base-responses";
import {
  apiResponseConfigCreatedSchema,
  apiResponseModelDefaultsSchema,
  createModelDefaultConfigInputSchema,
  updateModelDefaultConfigInputSchema,
} from "./schemas";

const logger = createLogger("langwatch:api:model-defaults");

patchZodOpenapi();

// Build a Session-shaped object for the service's RBAC walk. Hono
// auth gives us apiKeyUserId; user-bound PATs always carry one.
// Legacy project tokens don't — assertCanWriteScope rejects those,
// which is the documented API contract for default-model writes.
function sessionFor(userId: string | undefined): Session | null {
  if (!userId) return null;
  return { user: { id: userId } } as Session;
}

/**
 * Uniform error mapping for the default-model write handlers: a typed
 * HTTPException (e.g. the 404 orphan-config ownership backstop) passes through
 * untouched, any other Error collapses to a 400, and non-Error throwables
 * re-throw as-is.
 */
function rethrowModelDefaultsWriteError(err: unknown): never {
  if (err instanceof HTTPException) throw err;
  if (err instanceof Error) {
    throw new HTTPException(400, { message: err.message });
  }
  throw err;
}

export function registerModelDefaultsRoutes(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
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

      const snapshot = await getDefaultModelsSnapshot(
        { prisma, session: sessionFor(userId) },
        { projectId: project.id },
      );

      return c.json(
        apiResponseModelDefaultsSchema.parse({
          scope: {
            projectId: snapshot.projectId,
            teamId: snapshot.teamId,
            organizationId: snapshot.organizationId,
            organizationName: snapshot.organizationName,
          },
          effective: snapshot.effective,
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
  // data-dependent: assertCanWriteScope gates every target scope in-handler
  // (the Hono analogue of tRPC's authorizeInResolver), so the route policy is
  // "any authenticated caller" and the real check happens below.
  secured.access(anyAuthenticated()).post(
    "/",
    describeRoute({
      description:
        "Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.",
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
        // Authz: every target scope must pass the caller's manage check.
        for (const s of body.scopes) {
          await assertCanWriteScope(
            { prisma, session: sessionFor(userId) },
            s.scopeType,
            s.scopeId,
          );
        }
        const { id } = await createConfig(
          { prisma },
          {
            config: body.config,
            scopes: body.scopes,
            authorId: userId ?? null,
          },
        );
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
        const ctx = { prisma, session: sessionFor(userId) };
        // Authz: caller must be able to write every scope this config
        // is currently attached to AND every scope they're newly
        // attaching. Mirrors the tRPC save mutation's gate.
        const current = await getScopeAttachmentsForConfig({ prisma }, id);
        // Ownership backstop: a config with no scope attachments would skip the
        // per-scope write check below entirely, leaving it editable by any
        // authenticated caller across tenants. Treat an orphan config as not
        // found rather than silently authorizing the write.
        if (current.length === 0) {
          throw new HTTPException(404, { message: "Config not found" });
        }
        for (const s of current) {
          await assertCanWriteScope(ctx, s.scopeType, s.scopeId);
        }
        if (body.scopes) {
          for (const s of body.scopes) {
            await assertCanWriteScope(ctx, s.scopeType, s.scopeId);
          }
        }
        await updateConfig(
          { prisma },
          {
            id,
            config: body.config,
            scopes: body.scopes,
            authorId: userId ?? null,
          },
        );
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
        const ctx = { prisma, session: sessionFor(userId) };
        const current = await getScopeAttachmentsForConfig({ prisma }, id);
        // Same ownership backstop as PUT: an orphan config (no scope
        // attachments) must not be deletable by any authenticated caller.
        if (current.length === 0) {
          throw new HTTPException(404, { message: "Config not found" });
        }
        for (const s of current) {
          await assertCanWriteScope(ctx, s.scopeType, s.scopeId);
        }
        await deleteConfig({ prisma }, id);
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
