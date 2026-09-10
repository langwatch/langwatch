/**
 * What `/api/experiments` takes and answers. Declared here rather than beside
 * the router so a client generated from the contract reads the same shapes the
 * door publishes.
 */

import { z } from "zod";

import type { ExperimentType } from "./experiment.ts";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** One experiment as every route in the family reports it. */
export const experimentSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string().nullable(),
  type: z.string(),
  workflowId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  runsCount: z.number(),
  lastRunAt: z.string().nullable(),
});

export const experimentsListResponseSchema = z.object({
  experiments: z.array(experimentSummarySchema),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    totalHits: z.number(),
    hasMore: z.boolean(),
  }),
});

const parsePositiveInt = ({
  value,
  fallback,
  max,
}: {
  value: string | undefined;
  fallback: number;
  max?: number;
}): number => {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return max ? Math.min(parsed, max) : parsed;
};

/**
 * A page number that never rejects: a value that is not a positive integer has
 * always fallen back rather than refused the request, so the schema says that.
 */
const lenientPositiveInt = (fallback: number, max?: number) =>
  z
    .string()
    .optional()
    .transform((value) => parsePositiveInt({ value, fallback, ...(max ? { max } : {}) }));

export const listExperimentsQuerySchema = z.object({
  page: lenientPositiveInt(1).describe("1-based page number"),
  pageSize: lenientPositiveInt(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE).describe(
    `Experiments per page, capped at ${MAX_PAGE_SIZE}`,
  ),
});

export const slugParamsSchema = z.object({
  slug: z.string().min(1).describe("The experiment's slug, or its id"),
});

/**
 * `experiment_slug` and `experiment_id` are individually optional and jointly
 * required. `EVALUATIONS_V3` is deliberately not among the accepted types -
 * that is the workbench's own type, written through the workbench's doors.
 */
export const experimentInitBodySchema = z
  .object({
    experiment_id: z.string().optional().nullable(),
    experiment_slug: z.string().optional().nullable(),
    experiment_type: z.enum(["DSPY", "BATCH_EVALUATION", "BATCH_EVALUATION_V2"]),
    experiment_name: z.string().optional(),
    workflowId: z.string().optional(),
  })
  .refine((data) => Boolean(data.experiment_id ?? data.experiment_slug));

/** What an SDK names an experiment by on the create-or-take door. */
export type ExperimentRunLookupInput = Readonly<{
  projectId: string;
  experimentId?: string | null | undefined;
  experimentSlug?: string | null | undefined;
  experimentType: ExperimentType;
  experimentName?: string | undefined;
  workflowId?: string | undefined;
}>;
