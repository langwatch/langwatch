/**
 * LangWatchQL analytics SQL — the session-authenticated router the workbench calls.
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
 * @see ~/server/analytics/lwql — the service and everything under it
 * @see specs/analytics/lwql-workbench.feature
 */

import { NotFoundError } from "@langwatch/handled-error";
import { z } from "zod";

import {
  getLangWatchQLService,
  MAX_LWQL_LENGTH,
} from "~/server/analytics/lwql";
import { lwqlEnabled } from "~/server/analytics/lwql/access";
import { lwqlTimeWindowSchema } from "~/server/analytics/lwql/timeWindowSchema";

import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { getUserProtectionsForProject } from "../../utils";

import { enforceWorkbenchEnabled } from "./workbenchAccessMiddleware";

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
 * Which gate closed, when one did.
 *
 * `disabled` is the project's own switch being off, which its administrator can
 * change; `unprovisioned` is a deployment with no LangWatchQL identity to run as,
 * which they cannot. They read as different refusals, so the page has to be
 * able to tell them apart.
 */
export type LangWatchQLUnavailableReason = "disabled" | "unprovisioned";

export interface LangWatchQLAvailability {
  /** What the navigation entry and the page gate on. */
  readonly available: boolean;
  /** Absent when available. */
  readonly reason?: LangWatchQLUnavailableReason;
}

/**
 * Whether the LangWatchQL query path is switched on and provisioned.
 *
 * Separate from `schema` because the schema is answerable without an executor
 * (it is the catalog), so a deployment with no LangWatchQL identity would describe
 * a surface it cannot run. The navigation gates on this, never on the schema.
 *
 * The one procedure that reads the switch rather than being gated by it: its
 * whole job is to answer "off" out loud, so `enforceWorkbenchEnabled` — which
 * every other procedure on this surface chains — would refuse the very question
 * being asked.
 *
 * The shape is one object with an optional reason rather than a union, so a
 * consumer that only cares whether the surface is on keeps reading `available`
 * and nothing else.
 */
const availability = protectedProcedure
  .input(projectScopeSchema)
  .permission("analytics:view")
  .query(async ({ ctx, input }): Promise<LangWatchQLAvailability> => {
    const enabled = await lwqlEnabled({
      prisma: ctx.prisma,
      projectId: input.projectId,
    });
    if (!enabled) return { available: false, reason: "disabled" };

    if (!getLangWatchQLService().available) {
      return { available: false, reason: "unprovisioned" };
    }
    return { available: true };
  });

/** The LangWatchQL datasets and columns this member's permissions unlock. */
const schema = protectedProcedure
  .input(projectScopeSchema)
  .permission("analytics:view")
  .use(enforceWorkbenchEnabled)
  .query(async ({ ctx, input }) => {
    return getLangWatchQLService().describeSchema({
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
      sql: z.string().min(1).max(MAX_LWQL_LENGTH),
      parameters: z.record(z.string(), parameterValueSchema).optional(),
      timeWindow: lwqlTimeWindowSchema.optional(),
      /**
       * The datapoint step for a statement that declares
       * `{period_granularity_seconds:UInt32}`, in seconds. Shape only — the
       * bucket-budget arithmetic and its refusal are the service's.
       */
      granularitySeconds: z.number().int().positive().optional(),
    }),
  )
  .permission("analytics:view")
  .use(enforceWorkbenchEnabled)
  .mutation(async ({ ctx, input }) => {
    // The project's LangWatchQL secret is hashed into the tenant capability
    // the query runs under. It is read server-side and never leaves this
    // function — no field of it appears in the response.
    const project = await ctx.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, lwqlKey: true },
    });
    if (!project) {
      throw new NotFoundError("project_not_found", "Project", input.projectId);
    }

    return getLangWatchQLService().execute({
      project,
      protections: await getUserProtectionsForProject(ctx, {
        projectId: project.id,
      }),
      sql: input.sql,
      ...(input.parameters ? { parameters: input.parameters } : {}),
      ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
      ...(input.granularitySeconds === undefined
        ? {}
        : { granularitySeconds: input.granularitySeconds }),
    });
  });

export const lwqlRouter = createTRPCRouter({
  availability,
  schema,
  query,
});
