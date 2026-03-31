import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/server/db";
import { hasOrganizationPermission } from "~/server/api/rbac";
import { handleError } from "../../../../middleware/error-handler";
import { loggerMiddleware } from "../../../../middleware/logger";
import { tracerMiddleware } from "../../../../middleware/tracer";
import {
  BUILT_IN_LABELS,
  PromptLabelRepository,
  PromptLabelConflictError,
  PromptLabelValidationError,
} from "~/server/prompt-config/repositories/prompt-label.repository";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:prompt-labels");

export const app = new Hono().basePath("/api/orgs/:orgId/prompt-labels");

app.use(tracerMiddleware({ name: "prompt-labels" }));
app.use(loggerMiddleware());
app.onError(handleError);

async function requireSession(c: { req: { raw: Request } }) {
  const session = await getServerSession(
    authOptions(c.req.raw as NextRequest),
  );
  if (!session) {
    throw new HTTPException(401, {
      message: "You must be logged in to access this endpoint.",
    });
  }
  return session;
}

/**
 * GET /api/orgs/:orgId/prompt-labels
 * Returns all labels for the org: built-in + custom.
 * Requires org member access.
 */
app.get("/", async (c) => {
  const { orgId } = c.req.param();
  const session = await requireSession(c);

  const permitted = await hasOrganizationPermission(
    { prisma, session },
    orgId,
    "organization:view",
  );
  if (!permitted) {
    throw new HTTPException(403, {
      message: "You do not have permission to view labels for this org.",
    });
  }

  const repo = new PromptLabelRepository(prisma);
  const customLabels = await repo.list({ organizationId: orgId });

  const builtInItems = BUILT_IN_LABELS.map((name) => ({
    name,
    type: "built-in" as const,
  }));

  const customItems = customLabels.map((label) => ({
    id: label.id,
    name: label.name,
    type: "custom" as const,
    createdAt: label.createdAt,
  }));

  logger.info(
    { orgId, customCount: customLabels.length },
    "Listed prompt labels",
  );

  return c.json([...builtInItems, ...customItems]);
});

/**
 * POST /api/orgs/:orgId/prompt-labels
 * Creates a custom label definition.
 * Requires org admin access.
 */
app.post(
  "/",
  zValidator("json", z.object({ name: z.string() })),
  async (c) => {
    const { orgId } = c.req.param();
    const session = await requireSession(c);

    const permitted = await hasOrganizationPermission(
      { prisma, session },
      orgId,
      "organization:manage",
    );
    if (!permitted) {
      throw new HTTPException(403, {
        message: "You do not have permission to create labels for this org.",
      });
    }

    const { name } = c.req.valid("json");
    const repo = new PromptLabelRepository(prisma);

    try {
      const label = await repo.create({
        organizationId: orgId,
        name,
        createdById: session.user.id,
      });

      logger.info({ orgId, name }, "Custom prompt label created via API");

      return c.json(
        {
          id: label.id,
          name: label.name,
          createdAt: label.createdAt,
        },
        201,
      );
    } catch (error) {
      if (error instanceof PromptLabelValidationError) {
        throw new HTTPException(422, { message: error.message });
      }
      if (error instanceof PromptLabelConflictError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * DELETE /api/orgs/:orgId/prompt-labels/:labelId
 * Deletes a custom label definition and cascades to assignments.
 * Requires org admin access.
 */
app.delete("/:labelId", async (c) => {
  const { orgId, labelId } = c.req.param();
  const session = await requireSession(c);

  const permitted = await hasOrganizationPermission(
    { prisma, session },
    orgId,
    "organization:manage",
  );
  if (!permitted) {
    throw new HTTPException(403, {
      message: "You do not have permission to delete labels for this org.",
    });
  }

  // Reject attempts to delete built-in labels by ID lookup
  // (built-in labels have no DB rows, so getById returns null, but we check
  // if the labelId looks like a built-in name to give a clear error)
  if ((BUILT_IN_LABELS as readonly string[]).includes(labelId)) {
    throw new HTTPException(422, {
      message: `"${labelId}" is a built-in label and cannot be deleted.`,
    });
  }

  const repo = new PromptLabelRepository(prisma);

  const label = await repo.getById({ id: labelId, organizationId: orgId });

  if (!label) {
    throw new HTTPException(404, {
      message: `Label not found: ${labelId}`,
    });
  }

  await repo.delete({ id: labelId, organizationId: orgId });

  logger.info({ orgId, labelId }, "Custom prompt label deleted via API");

  return new Response(null, { status: 204 });
});
