import type { PrismaClient } from "@prisma/client";
import { batchScopePermissions } from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import { prisma as defaultPrisma } from "~/server/db";

/**
 * The organization's projects split by what one caller may do with each: read
 * traces, and price them.
 *
 * Two separate cuts on purpose. `traces:view` decides whether a project's work
 * appears at all; `cost:view` decides whether that work carries money. A
 * project the caller may read but not price still contributes its tokens with
 * a null cost, because the work happened and hiding it would understate the
 * answer.
 *
 * The project list is enumerated HERE, from the organization, and never taken
 * from the request: a caller that could name the projects to count could count
 * one it may not read. Resolved through the same `batchScopePermissions` the
 * in-app surfaces use, in a fixed number of queries rather than one per
 * project, so the REST answer and the page's answer cannot drift.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
export interface CallerProjectScope {
  /** Projects the caller may read. Work outside it never appears. */
  permittedProjectIds: string[];
  /** The subset of those the caller may also price. */
  costProjectIds: string[];
  /** Display names of the permitted projects, keyed by project id. */
  projectNames: Record<string, string>;
}

export async function resolveCallerProjectScope({
  userId,
  organizationId,
  prisma = defaultPrisma,
}: {
  userId: string;
  organizationId: string;
  prisma?: PrismaClient;
}): Promise<CallerProjectScope> {
  const projects = await prisma.project.findMany({
    where: { team: { organizationId }, archivedAt: null },
    select: { id: true, name: true, teamId: true },
  });
  if (projects.length === 0) {
    return { permittedProjectIds: [], costProjectIds: [], projectNames: {} };
  }

  const projectTeamId = Object.fromEntries(
    projects.map((project) => [project.id, project.teamId]),
  );
  const ctx = {
    prisma,
    // Minimal session shape: the resolver only reads user.id.
    session: { user: { id: userId }, expires: "" } satisfies Session,
  };
  const args = {
    organizationId,
    teamIds: [],
    projectIds: projects.map((project) => project.id),
    projectTeamId,
  };
  const [viewable, priceable] = await Promise.all([
    batchScopePermissions(ctx, { ...args, permission: "traces:view" }),
    batchScopePermissions(ctx, { ...args, permission: "cost:view" }),
  ]);

  const permitted = projects.filter(
    (project) => viewable.projects.get(project.id) === true,
  );
  const permittedProjectIds = permitted.map((project) => project.id);
  return {
    permittedProjectIds,
    costProjectIds: permittedProjectIds.filter(
      (id) => priceable.projects.get(id) === true,
    ),
    projectNames: Object.fromEntries(
      permitted.map((project) => [project.id, project.name]),
    ),
  };
}
