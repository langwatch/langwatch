import type { Session } from "~/server/auth";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";

import { prisma } from "~/server/db";
import {
  assertCanWriteScope,
  createConfig,
  deleteConfig,
  getScopeAttachmentsForConfig,
  updateConfig,
} from "~/server/modelProviders/modelDefaults.service";
import { getDefaultModelsSnapshot } from "~/server/modelProviders/modelDefaults.read";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";

import {
  type AuthMiddlewareVariables,
  type OrganizationMiddlewareVariables,
  organizationMiddleware,
} from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import {
  apiResponseConfigCreatedSchema,
  apiResponseModelDefaultsSchema,
  createModelDefaultConfigInputSchema,
  updateModelDefaultConfigInputSchema,
} from "./schemas";

const logger = createLogger("langwatch:api:model-defaults");

patchZodOpenapi();

type Variables = AuthMiddlewareVariables & OrganizationMiddlewareVariables;

export const app = new Hono<{ Variables: Variables }>().basePath("/");

app.use("/*", organizationMiddleware);

// Build a Session-shaped object for the service's RBAC walk. Hono
// auth gives us apiKeyUserId; user-bound PATs always carry one.
// Legacy project tokens don't — assertCanWriteScope rejects those,
// which is the documented API contract for default-model writes.
function sessionFor(userId: string | undefined): Session | null {
  if (!userId) return null;
  return { user: { id: userId } } as Session;
}

// GET /api/model-defaults — snapshot for the current project.
app.get(
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

// POST /api/model-defaults — create a new config.
app.post(
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
      if (err instanceof Error) {
        throw new HTTPException(400, { message: err.message });
      }
      throw err;
    }
  },
);

// PUT /api/model-defaults/:id — update an existing config.
app.put(
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
      if (err instanceof Error) {
        throw new HTTPException(400, { message: err.message });
      }
      throw err;
    }
  },
);

// DELETE /api/model-defaults/:id — delete a config.
app.delete(
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
      if (err instanceof Error) {
        throw new HTTPException(400, { message: err.message });
      }
      throw err;
    }
  },
);
