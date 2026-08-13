/**
 * Governed analytics SQL — the session-authenticated router the workbench calls.
 *
 * The REST endpoints in `~/app/api/analytics-sql` serve API keys; this serves a
 * signed-in member looking at the Custom query page. Same service, same policy,
 * different credential — so the only thing that differs is where *who is
 * asking* comes from: `getUserProtectionsForProject` resolves the member's own
 * content permissions from the session, where the REST path resolves an API
 * key's.
 *
 * ## Nothing here validates SQL
 *
 * The Zod input describes the request *shape* and stops there. Parsing, the
 * default-deny policy, tenant isolation and the resource ceilings all live in
 * the service, and a second opinion at this layer could only ever disagree with
 * it — refusing something the service would allow, or worse, allowing something
 * it would refuse and teaching a caller the wrong rule.
 *
 * @see ~/server/analytics/governed-sql — the service and everything under it
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { NotFoundError } from "@langwatch/handled-error";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";

import { getGovernedSqlService } from "~/server/analytics/governed-sql";
import { GovernedSqlNotEnabledError } from "~/server/analytics/governed-sql/errors";
import { workbenchEnabled } from "~/server/analytics/workbenchFeatureGate";

import { checkProjectPermission } from "../../rbac";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { getUserProtectionsForProject } from "../../utils";

/**
 * Longest statement this router accepts.
 *
 * Mirrors the REST ceiling deliberately: it is a request-shape bound, not a
 * cost one, and a workbench that accepted a statement the API would reject
 * would be teaching its own dialect.
 */
const MAX_SQL_LENGTH = 50_000;

/**
 * A bound parameter's value. Scalars only — a parameter is a *value*, and
 * anything structured would be one whose shape a ClickHouse type cannot
 * describe.
 */
const parameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const projectScopeSchema = z.object({ projectId: z.string() });

/**
 * Whether the governed query path is provisioned on this deployment.
 *
 * Separate from `schema` because the schema is answerable without an executor
 * (it is the catalog), so a deployment with no governed identity would describe
 * a surface it cannot run. The navigation gates on this, never on the schema.
 */
const availability = protectedProcedure
  .input(projectScopeSchema)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ ctx, input }) => ({
    available:
      (await workbenchEnabled({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        projectId: input.projectId,
      })) && getGovernedSqlService().available,
  }));

/** The governed datasets and columns this member's permissions unlock. */
const schema = protectedProcedure
  .input(projectScopeSchema)
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ ctx, input }) => {
    if (
      !(await workbenchEnabled({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        projectId: input.projectId,
      }))
    ) {
      throw new GovernedSqlNotEnabledError();
    }
    return getGovernedSqlService().describeSchema({
      protections: await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      }),
    });
  });

/**
 * Runs one submitted statement, exactly as written.
 *
 * Handled errors propagate untouched: the tRPC boundary already serialises a
 * `HandledError` into a code plus its `meta` (see `handledErrorMiddleware` in
 * `~/server/api/trpc`), and the workbench renders registry copy keyed by that
 * code. Catching and rewrapping here would replace a refusal the member can act
 * on with one they cannot.
 */
const query = protectedProcedure
  .input(
    projectScopeSchema.extend({
      // Deliberately not `.trim()`: the statement the database runs must be the
      // one that was submitted.
      sql: z.string().min(1).max(MAX_SQL_LENGTH),
      parameters: z.record(z.string(), parameterValueSchema).optional(),
    }),
  )
  .use(checkProjectPermission("analytics:view"))
  .mutation(async ({ ctx, input }) => {
    if (
      !(await workbenchEnabled({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        projectId: input.projectId,
      }))
    ) {
      throw new GovernedSqlNotEnabledError();
    }

    // The project's governed SQL secret is hashed into the tenant capability
    // the query runs under. It is read server-side and never leaves this
    // function — no field of it appears in the response.
    const project = await ctx.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, governedSqlKey: true },
    });
    if (!project) {
      throw new NotFoundError("project_not_found", "Project", input.projectId);
    }

    return getGovernedSqlService().execute({
      project,
      protections: await getUserProtectionsForProject(ctx, {
        projectId: project.id,
      }),
      sql: input.sql,
      ...(input.parameters ? { parameters: input.parameters } : {}),
    });
  });

export const governedSqlRouter = createTRPCRouter({
  availability,
  schema,
  query,
});
