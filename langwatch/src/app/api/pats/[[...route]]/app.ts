import type { Organization } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { prisma } from "~/server/db";
import { PatService } from "~/server/pat/pat.service";
import {
  PatNotFoundError,
  PatNotOwnedError,
  PatAlreadyRevokedError,
  PatScopeViolationError,
} from "~/server/pat/errors";
import type { OrgAuthMiddlewareVariables } from "../../middleware/org-auth";
import { orgAuthMiddleware } from "../../middleware/org-auth";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { handlePatError } from "./error-handler";

patchZodOpenapi();

type Variables = OrgAuthMiddlewareVariables;

const createPatSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  expiresAt: z.coerce.date().optional(),
  bindings: z
    .array(
      z.object({
        role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
        scopeId: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

function validationHook(
  result: {
    success: boolean;
    error?: {
      issues: Array<{ message?: string; path?: (string | number)[] }>;
    };
  },
  c: { json: (body: unknown, status: number) => Response },
): Response | undefined {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    return c.json(
      {
        error: "Unprocessable Entity",
        message: issue?.message ?? "Validation failed",
        path: issue?.path,
      },
      422,
    );
  }
  return undefined;
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/pats")
  .use(tracerMiddleware({ name: "pats" }))
  .use(loggerMiddleware())
  .use(orgAuthMiddleware)
  .onError(handlePatError)

  .get(
    "/",
    describeRoute({
      description: "List all Personal Access Tokens for the authenticated user in this organization",
    }),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const userId = c.get("patUserId") as string;
      const patService = PatService.create(prisma);

      const pats = await patService.list({
        userId,
        organizationId: organization.id,
      });

      return c.json({
        data: pats.map((pat) => ({
          id: pat.id,
          name: pat.name,
          description: pat.description,
          createdAt: pat.createdAt,
          expiresAt: pat.expiresAt,
          lastUsedAt: pat.lastUsedAt,
          revokedAt: pat.revokedAt,
          roleBindings: pat.roleBindings.map((rb) => ({
            id: rb.id,
            role: rb.role,
            scopeType: rb.scopeType,
            scopeId: rb.scopeId,
          })),
        })),
      });
    },
  )

  .post(
    "/",
    describeRoute({
      description: "Create a new Personal Access Token",
    }),
    zValidator("json", createPatSchema, validationHook),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const userId = c.get("patUserId") as string;
      const body = c.req.valid("json");
      const patService = PatService.create(prisma);

      try {
        const result = await patService.create({
          name: body.name,
          description: body.description,
          userId,
          organizationId: organization.id,
          expiresAt: body.expiresAt,
          bindings: body.bindings,
        });

        return c.json(
          {
            token: result.token,
            pat: {
              id: result.pat.id,
              name: result.pat.name,
              createdAt: result.pat.createdAt,
            },
          },
          201,
        );
      } catch (error) {
        if (error instanceof PatScopeViolationError) {
          return c.json(
            { error: "Forbidden", message: error.message },
            403,
          );
        }
        throw error;
      }
    },
  )

  .delete(
    "/:id",
    describeRoute({
      description: "Revoke a Personal Access Token",
    }),
    async (c) => {
      const { id } = c.req.param();
      const userId = c.get("patUserId") as string;
      const patService = PatService.create(prisma);

      try {
        await patService.revoke({ id, userId });
      } catch (error) {
        if (error instanceof PatNotFoundError) {
          return c.json(
            { error: "Not Found", message: "Personal Access Token not found" },
            404,
          );
        }
        if (error instanceof PatNotOwnedError) {
          return c.json(
            { error: "Forbidden", message: error.message },
            403,
          );
        }
        if (error instanceof PatAlreadyRevokedError) {
          return c.json(
            { error: "Conflict", message: error.message },
            409,
          );
        }
        throw error;
      }

      return c.json({ success: true });
    },
  );
