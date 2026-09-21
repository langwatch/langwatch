/**
 * Who a session-authenticated LangWatchQL execution runs as.
 *
 * Every tRPC procedure that hands a statement to the LangWatchQL service —
 * the workbench's ad-hoc `query` and the saved chart's `run` — needs the same
 * two answers resolved the same way: the project row carrying the `lwqlKey`
 * the tenant capability is hashed from, and the member's own content
 * protections. One resolver keeps those two doors from drifting apart.
 */

import { NotFoundError } from "@langwatch/handled-error";
import type { PrismaClient } from "~/generated/prisma/client";
import type { Session } from "~/server/auth";

import { getUserProtectionsForProject } from "../../utils";

/**
 * Resolves the project identity and the member's protections a LangWatchQL
 * execution runs under.
 *
 * The project's LangWatchQL secret is hashed into the tenant capability the
 * query runs under. It is read server-side and must never leave the calling
 * procedure — no field of it may appear in a response.
 */
export async function resolveLangWatchQLCaller({
  ctx,
  projectId,
}: {
  ctx: { prisma: PrismaClient; session: Session | null };
  projectId: string;
}) {
  const project = await ctx.prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, lwqlKey: true },
  });
  if (!project) {
    throw new NotFoundError("project_not_found", "Project", projectId);
  }

  return {
    project,
    protections: await getUserProtectionsForProject(ctx, { projectId }),
  };
}
