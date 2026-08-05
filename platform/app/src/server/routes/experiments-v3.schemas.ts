/**
 * OpenAPI schemas for the API-key half of the experiments REST surface.
 *
 * Only the routes an integrator calls with a project API key live here — the
 * run trigger and the three read endpoints. `execute` and `abort` authenticate
 * with a browser session and belong to the workbench UI, so they are not
 * described and do not reach the published document.
 *
 * These describe responses the handlers already send. They do not validate
 * anything at runtime; the handlers keep their own parsing.
 */

import { z } from "zod";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";

patchZodOpenapi();

/** Run lifecycle as the poll endpoint reports it. */
export const runStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "stopped",
]);

const paginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  totalHits: z.number(),
  hasMore: z.boolean(),
});

export const startRunResponseSchema = z.object({
  runId: z.string().describe("Identifier to poll this run with"),
  status: z.literal("running"),
  total: z.number().describe("Number of cells this run will execute"),
  runUrl: z
    .string()
    .optional()
    .describe("Link to the run in the LangWatch app"),
});

const evaluationSummarySchema = z.object({
  name: z.string(),
  averageScore: z.number().nullable(),
  averagePassed: z.number().optional(),
});

const runSummarySchema = z.object({
  datasetCost: z.number().optional(),
  evaluationsCost: z.number().optional(),
  datasetAverageCost: z.number().optional(),
  datasetAverageDuration: z.number().optional(),
  evaluationsAverageCost: z.number().optional(),
  evaluationsAverageDuration: z.number().optional(),
  evaluations: z.record(z.string(), evaluationSummarySchema),
});

const runTimestampsSchema = z.object({
  createdAt: z.number(),
  updatedAt: z.number(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
});

const runListEntrySchema = z.object({
  experimentId: z.string(),
  runId: z.string(),
  workflowVersion: z
    .object({
      id: z.string(),
      version: z.string(),
      commitMessage: z.string(),
      author: z
        .object({ name: z.string().nullable(), image: z.string().nullable() })
        .nullable(),
    })
    .nullable(),
  timestamps: runTimestampsSchema,
  progress: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  summary: runSummarySchema,
});

export const listRunsResponseSchema = z.object({
  experimentId: z.string(),
  experimentSlug: z.string(),
  runs: z.array(runListEntrySchema),
  pagination: paginationSchema,
});

/**
 * The poll response. Which fields are present depends on `status`: a run still
 * going carries progress only, a finished one adds `finishedAt` and either a
 * `summary` or the failure's stable `error` code. Optionality here reflects
 * that, rather than four separate documented shapes for one endpoint.
 */
export const runStatusResponseSchema = z.object({
  runId: z.string(),
  status: runStatusSchema,
  progress: z.number().describe("Cells finished so far"),
  total: z.number().describe("Cells in the run"),
  startedAt: z.number().optional().describe("Unix milliseconds"),
  finishedAt: z
    .number()
    .optional()
    .describe("Unix milliseconds; set once the run is no longer running"),
  summary: runSummarySchema.optional().describe("Present when completed"),
  error: z
    .string()
    .optional()
    .describe(
      "Stable failure code, present when failed. Not display copy: render your own wording keyed on it.",
    ),
  traceId: z
    .string()
    .optional()
    .describe("Trace id for failures that carry no code, to quote in support"),
});

const datasetEntrySchema = z.object({
  index: z.number(),
  targetId: z.string().nullable().optional(),
  entry: z.record(z.string(), z.unknown()),
  predicted: z.record(z.string(), z.unknown()).optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
});

const evaluationResultSchema = z.object({
  evaluator: z.string(),
  name: z.string().nullable().optional(),
  targetId: z.string().nullable().optional(),
  status: z.enum(["processed", "skipped", "error"]),
  index: z.number(),
  score: z.number().nullable().optional(),
  label: z.string().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  details: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const runResultsResponseSchema = z.object({
  experimentId: z.string(),
  runId: z.string(),
  projectId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  progress: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  dataset: z
    .array(datasetEntrySchema)
    .describe("One row per dataset entry, with what the target predicted"),
  evaluations: z
    .array(evaluationResultSchema)
    .describe("One row per evaluator per dataset entry"),
  timestamps: runTimestampsSchema,
});

export const experimentInitResponseSchema = z.object({
  slug: z.string().describe("Slug of the experiment, created or existing"),
  path: z.string().describe("Path to the experiment in the LangWatch app"),
});
