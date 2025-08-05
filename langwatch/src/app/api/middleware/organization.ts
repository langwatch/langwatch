import type { Organization } from "@prisma/client";
import { type MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";

/**
 * Variables set by the organization middleware
 */
export type OrganizationMiddlewareVariables = {
  organization: Organization;
};

export const organizationMiddleware: MiddlewareHandler = async (c, next) => {
  const project = c.get("project");

  if (!project) {
    return c.json(
      {
        error: "Internal Server Error",
        message: "Trying to use organization middleware without project",
      },
      500
    );
  }

  const team = await prisma.team.findUnique({
    where: { id: project.teamId },
    include: { organization: true },
  });

  const organization = team?.organization;
  if (!organization) {
    return c.json(
      {
        error: "Internal Server Error",
        message: "Organization not found",
      },
      500
    );
  }

  c.set("organization", organization);

  await next();
};
