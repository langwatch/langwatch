/**
 * The Instant Eval run as the Trace Explorer drives it: an estimate, a start,
 * a cancel and a poll, all over the same run service the REST family exposes.
 *
 * The Explorer never writes a statement. It sends the search bar's own
 * vocabulary (a target, the other chips as the filter, the exact window and
 * one yes-or-no question) and the shorthand writes the statement, so a run
 * started here is the same run a CLI caller would start with `--target`.
 *
 * Permissions match the REST family: `analytics:manage` to spend, and
 * `analytics:view` to read a run back.
 *
 * @see ~/server/app-layer/instant-evals/run
 * @see ../../../app/api/instant-evals/[[...route]]/app.ts: the REST family
 * @see ../../../../../specs/traces-v2/instant-eval-search.feature
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getUserProtectionsForProject } from "~/server/api/utils";
import {
  getInstantEvalRunService,
  type InstantEvalRunInput,
  toInstantEvalExplorerRun,
} from "~/server/app-layer/instant-evals/run";
import { INSTANT_EVAL_TARGETS } from "~/server/app-layer/instant-evals/shorthand";
import { explorerHiddenOrigins } from "~/server/app-layer/traces/hidden-origins";
import { queryWithoutInstantEvalChips } from "~/server/app-layer/traces/query-language/instantEvalChips";
import { combineQueries } from "~/server/app-layer/traces/query-language/mutations";

/**
 * Epoch milliseconds a JavaScript `Date` can represent. The run input is
 * turned into ISO instants below, and `toISOString()` raises a `RangeError`
 * past this, which would reach the caller as an internal error rather than as
 * the validation failure it is.
 */
const EPOCH_MS = z
  .number()
  .int()
  .min(-8_640_000_000_000_000)
  .max(8_640_000_000_000_000);

/** What the Explorer asks to judge: the shorthand, in the search bar's words. */
export const explorerInstantEvalRunSchema = z.object({
  projectId: z.string(),
  target: z.enum(INSTANT_EVAL_TARGETS),
  /** The other chips of the query, as the filter narrowing what is judged. */
  filter: z.string().max(4_000).default(""),
  /** The exact bounds the search ran in, frozen for the run's life. */
  window: z.object({ from: EPOCH_MS, to: EPOCH_MS }),
  question: z.object({
    instructions: z.string().min(1).max(2_000),
    /** What counts as yes, then what counts as no. */
    criteria: z
      .tuple([z.string().min(1).max(500), z.string().min(1).max(500)])
      .optional(),
  }),
  /** Rows the run may judge. Absent means the default cap. */
  limit: z.number().int().positive().optional(),
});

export type ExplorerInstantEvalRunInput = z.infer<
  typeof explorerInstantEvalRunSchema
>;

/** The run service's input for what the Explorer asked. */
/**
 * The filter a run judges: the other chips, minus any eval chip and minus the
 * origins the Explorer hides.
 *
 * An eval chip is dropped here as well as on the client. A run has no run
 * reference for another chip's question, so the selection compiler would fall
 * back to the legacy evaluator-name meaning of a bare `eval:` and judge a
 * different set than the Explorer shows. A second question judges the query
 * without either chip, and both chips then intersect when the list is read
 * (specs/traces-v2/instant-eval-search.feature, "A second question judges the
 * same rows as the first").
 *
 * The table leaves Langy's own traces out unless the query names an origin,
 * so a run over the bare chips would judge rows the table cannot show, and
 * its total would disagree with the count beside it.
 */
export function explorerJudgedFilter(filter: string): string {
  const scope = queryWithoutInstantEvalChips(filter);
  return combineQueries({
    base: scope,
    addition: explorerHiddenOrigins(scope)
      .map((origin) => `NOT origin:${origin}`)
      .join(" AND "),
  });
}

export function toExplorerRunInput(
  input: ExplorerInstantEvalRunInput,
): InstantEvalRunInput {
  return {
    shorthand: {
      target: input.target,
      filter: explorerJudgedFilter(input.filter),
      start: new Date(input.window.from).toISOString(),
      end: new Date(input.window.to).toISOString(),
      questions: [
        {
          id: "matched",
          kind: "boolean",
          instructions: input.question.instructions,
          ...(input.question.criteria
            ? { criteria: [...input.question.criteria] }
            : {}),
        },
      ],
    },
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

const runIdSchema = z.object({
  projectId: z.string(),
  runId: z.string().min(1).max(200),
});

export const tracesV2InstantEvalRouter = createTRPCRouter({
  estimate: protectedProcedure
    .input(explorerInstantEvalRunSchema)
    .permission("analytics:manage")
    .mutation(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      return await getInstantEvalRunService().estimate({
        projectId: input.projectId,
        protections,
        input: toExplorerRunInput(input),
      });
    }),

  start: protectedProcedure
    .input(explorerInstantEvalRunSchema)
    .permission("analytics:manage")
    .mutation(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });
      const row = await getInstantEvalRunService().create({
        projectId: input.projectId,
        protections,
        input: toExplorerRunInput(input),
      });
      return toInstantEvalExplorerRun(row);
    }),

  cancel: protectedProcedure
    .input(runIdSchema)
    .permission("analytics:manage")
    .mutation(async ({ input, ctx }) => {
      const requestedByUserId = ctx.session?.user?.id;
      const row = await getInstantEvalRunService().cancel({
        projectId: input.projectId,
        runId: input.runId,
        ...(requestedByUserId ? { requestedByUserId } : {}),
      });
      return toInstantEvalExplorerRun(row);
    }),

  get: protectedProcedure
    .input(runIdSchema)
    .permission("analytics:view")
    .query(async ({ input }) => {
      const row = await getInstantEvalRunService().get({
        projectId: input.projectId,
        runId: input.runId,
      });
      return toInstantEvalExplorerRun(row);
    }),
});
