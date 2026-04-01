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
  PromptTagRepository,
  PromptTagConflictError,
  PromptTagValidationError,
  PROTECTED_TAGS,
  type ProtectedTag,
} from "~/server/prompt-config/repositories/prompt-tag.repository";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:prompt-tags");

export const app = new Hono().basePath("/api/orgs/:orgId/prompt-tags");

app.use(tracerMiddleware({ name: "prompt-tags" }));
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
 * GET /api/orgs/:orgId/prompt-tags
 * Returns all tags for the org.
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
      message: "You do not have permission to view tags for this org.",
    });
  }

  const repo = new PromptTagRepository(prisma);
  const tags = await repo.list({ organizationId: orgId });

  logger.info(
    { orgId, count: tags.length },
    "Listed prompt tags",
  );

  return c.json(
    tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      createdAt: tag.createdAt,
    })),
  );
});

/**
 * POST /api/orgs/:orgId/prompt-tags
 * Creates a custom tag definition.
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
        message: "You do not have permission to create tags for this org.",
      });
    }

    const { name } = c.req.valid("json");
    const repo = new PromptTagRepository(prisma);

    try {
      const tag = await repo.create({
        organizationId: orgId,
        name,
        createdById: session.user.id,
      });

      logger.info({ orgId, name }, "Custom prompt tag created via API");

      return c.json(
        {
          id: tag.id,
          name: tag.name,
          createdAt: tag.createdAt,
        },
        201,
      );
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

/**
 * DELETE /api/orgs/:orgId/prompt-tags/:tagId
 * Deletes a custom tag definition and cascades to assignments.
 * Requires org admin access.
 */
app.delete("/:tagId", async (c) => {
  const { orgId, tagId } = c.req.param();
  const session = await requireSession(c);

  const permitted = await hasOrganizationPermission(
    { prisma, session },
    orgId,
    "organization:manage",
  );
  if (!permitted) {
    throw new HTTPException(403, {
      message: "You do not have permission to delete tags for this org.",
    });
  }

  const repo = new PromptTagRepository(prisma);

  const tag = await repo.getById({ id: tagId, organizationId: orgId });

  if (!tag) {
    throw new HTTPException(404, {
      message: `Tag not found: ${tagId}`,
    });
  }

  if (PROTECTED_TAGS.includes(tag.name as ProtectedTag)) {
    throw new HTTPException(422, {
      message: `"${tag.name}" is a protected tag and cannot be deleted.`,
    });
  }

  await repo.delete({ id: tagId, organizationId: orgId });

  logger.info({ orgId, tagId }, "Custom prompt tag deleted via API");

  return new Response(null, { status: 204 });
});
