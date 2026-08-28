import type { MiddlewareHandler } from "hono";
import { TeamNotFoundError } from "@langwatch/organization-contract";

/**
 * Variables set by the organization middleware
 */
export type OrganizationMiddlewareVariables = {
  organization: Readonly<{ id: string }>;
};

export const organizationMiddleware: MiddlewareHandler = async (c, next) => {
  const project = c.get("project");

  if (!project) {
    return c.json(
      {
        error: "Internal Server Error",
        message: "Trying to use organization middleware without project",
      },
      500,
    );
  }

  try {
    const team = await c.app.organizations.getTeamById({ teamId: project.teamId });
    c.set("organization", { id: team.organizationId });
  } catch (error) {
    if (!(error instanceof TeamNotFoundError)) throw error;
    return c.json(
      {
        error: "Internal Server Error",
        message: "Organization not found",
      },
      500,
    );
  }

  await next();
};
