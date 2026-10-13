/**
 * What the API-key half of `/api/experiments` takes and answers, as main
 * published it.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import { experimentRunCompletenessSchema } from "./experiment-run.ts";
import type { WorkbenchCredential } from "./experiment.api.ts";
import type { EvaluationV3Event } from "./workbench/execution/types.ts";

const runIdParamsSchemaDefinition = z.object({ runId: z.string().min(1) });
export interface RunIdParamsSchema extends Named<typeof runIdParamsSchemaDefinition> {}
export const runIdParamsSchema: RunIdParamsSchema = runIdParamsSchemaDefinition;

/** A positive integer as main published it; anything else reads as absent, never a refusal. */
export const lenientPositiveIntSchema = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .catch(undefined);

/**
 * A path version is always present, so a segment that is no version number
 * reads as 0, which none is.
 */
const pathVersionSchema = z.preprocess((raw) => {
  const version = Number(raw);
  return Number.isInteger(version) && version > 0 ? version : 0;
}, z.number().int().nonnegative());

const slugVersionParamsSchemaDefinition = z.object({
  slug: z.string().min(1),
  version: pathVersionSchema.describe(
    "The version to restore, as listed by `GET /api/experiments/{slug}/versions`",
  ),
});
export interface SlugVersionParamsSchema extends Named<typeof slugVersionParamsSchemaDefinition> {}
export const slugVersionParamsSchema: SlugVersionParamsSchema = slugVersionParamsSchemaDefinition;

/** `/api/evaluations/v3`'s slug segment: `:slug`'s position, named for what it identifies. */
const evaluationSlugParamsSchemaDefinition = z.object({
  evaluationSlug: z.string().min(1).describe("The experiment's slug, or its id"),
});
export interface EvaluationSlugParamsSchema extends Named<
  typeof evaluationSlugParamsSchemaDefinition
> {}
export const evaluationSlugParamsSchema: EvaluationSlugParamsSchema =
  evaluationSlugParamsSchemaDefinition;

const evaluationSlugVersionParamsSchemaDefinition = z.object({
  evaluationSlug: z.string().min(1),
  version: pathVersionSchema,
});
export interface EvaluationSlugVersionParamsSchema extends Named<
  typeof evaluationSlugVersionParamsSchemaDefinition
> {}
export const evaluationSlugVersionParamsSchema: EvaluationSlugVersionParamsSchema =
  evaluationSlugVersionParamsSchemaDefinition;

/** A bad page number falls back rather than refusing; a missing slug 400s in the handler. */
const listRunsQuerySchemaDefinition = z.object({
  experimentSlug: z.string().optional().describe("Slug of the experiment whose runs you want"),
  page: lenientPositiveIntSchema.describe("1-based page number"),
  pageSize: lenientPositiveIntSchema.describe("Runs per page, capped at 200"),
});
export interface ListRunsQuerySchema extends Named<typeof listRunsQuerySchemaDefinition> {}
export const listRunsQuerySchema: ListRunsQuerySchema = listRunsQuerySchemaDefinition;

const runResultsQuerySchemaDefinition = z.object({
  experimentSlug: z
    .string()
    .optional()
    .describe("Owning experiment. Required once the run has aged out of the status cache."),
});
export interface RunResultsQuerySchema extends Named<typeof runResultsQuerySchemaDefinition> {}
export const runResultsQuerySchema: RunResultsQuerySchema = runResultsQuerySchemaDefinition;

const workbenchStateQuerySchemaDefinition = z.object({
  fields: z
    .string()
    .optional()
    .describe("Set to `version` to answer with the version and timestamp only"),
});
export interface WorkbenchStateQuerySchema extends Named<
  typeof workbenchStateQuerySchemaDefinition
> {}
export const workbenchStateQuerySchema: WorkbenchStateQuerySchema =
  workbenchStateQuerySchemaDefinition;

const listVersionsQuerySchemaDefinition = z.object({
  limit: lenientPositiveIntSchema.describe("Versions per page, capped at 100"),
  cursor: lenientPositiveIntSchema.describe("The `nextCursor` of the previous page"),
});
export interface ListVersionsQuerySchema extends Named<typeof listVersionsQuerySchemaDefinition> {}
export const listVersionsQuerySchema: ListVersionsQuerySchema = listVersionsQuerySchemaDefinition;

/** Run lifecycle as the poll endpoint reports it. */
export const runStatusSchema = z.enum(["pending", "running", "completed", "failed", "stopped"]);

const paginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  totalHits: z.number(),
  hasMore: z.boolean(),
});

/**
 * What the REST boundary sends when a route throws a `HandledError`. `error` carries the
 * stable code; branch on it and render customer-facing copy from your own registry (ADR-045).
 */
const handledErrorEnvelopeSchemaDefinition = z
  .object({
    error: z.string().describe("Stable failure code; branch on this"),
    message: z.string().optional(),
    fault: z
      .string()
      .optional()
      .describe(
        "Who the failure is attributable to: customer, platform, presumed_platform, provider",
      ),
    tips: z.array(z.string()).optional(),
    docsUrl: z.string().optional(),
  })
  .passthrough();
export interface HandledErrorEnvelopeSchema extends Named<
  typeof handledErrorEnvelopeSchemaDefinition
> {}
export const handledErrorEnvelopeSchema: HandledErrorEnvelopeSchema =
  handledErrorEnvelopeSchemaDefinition;

/**
 * The 409 a workbench write answers with when someone else saved first.
 * `StaleWorkbenchStateError`'s `currentVersion` arrives as a sibling of
 * `error` (the REST boundary spreads `meta` flat) — reloading is the remedy.
 */
const staleWorkbenchStateErrorSchemaDefinition = handledErrorEnvelopeSchema.safeExtend({
  currentVersion: z
    .number()
    .int()
    .describe("The stored version now. Read the setup again at this one."),
});
export interface StaleWorkbenchStateErrorSchema extends Named<
  typeof staleWorkbenchStateErrorSchemaDefinition
> {}
export const staleWorkbenchStateErrorSchema: StaleWorkbenchStateErrorSchema =
  staleWorkbenchStateErrorSchemaDefinition;

/**
 * A failure we could name, serialized for clients to branch on (ADR-045). Nested form on runs
 * or rows; distinct from handledErrorEnvelopeSchema (flat body on request failures).
 */
const handledErrorSchema = z.object({
  code: z.string().describe("Stable failure code; branch on this"),
  kind: z.string().describe("Deprecated alias of code, for older clients"),
  message: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  httpStatus: z.number().optional(),
  fault: z
    .string()
    .optional()
    .describe(
      "Who the failure is attributable to: customer, platform, presumed_platform, provider",
    ),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  traceUrl: z.string().optional(),
  retryable: z.boolean().optional(),
  tips: z.array(z.string()).readonly().optional(),
  docsUrl: z.string().optional(),
  reasons: z.array(z.unknown()).optional(),
});

const startRunResponseSchemaDefinition = z.object({
  runId: z.string().describe("Identifier to poll this run with"),
  status: z.literal("running"),
  total: z.number().describe("Number of cells this run will execute"),
  runUrl: z.string().optional().describe("Link to the run in the LangWatch app"),
});
export interface StartRunResponseSchema extends Named<typeof startRunResponseSchemaDefinition> {}
export const startRunResponseSchema: StartRunResponseSchema = startRunResponseSchemaDefinition;

const evaluationSummarySchema = z.object({
  name: z.string(),
  averageScore: z.number().nullable(),
  averagePassed: z.number().optional(),
});

/**
 * The aggregate a run row carries in LIST response — costs and durations per evaluator.
 * Distinct from executionSummarySchema (live execution tally in Redis for polling).
 */
const runAggregateSummarySchema = z.object({
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
      author: z.object({ name: z.string().nullable(), image: z.string().nullable() }).nullable(),
    })
    .nullable(),
  timestamps: runTimestampsSchema,
  progress: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  summary: runAggregateSummarySchema,
});

/** The flat refusal main published on the run doors: one sentence, no code. */
const runRefusalSchemaDefinition = z.object({
  error: z.string().describe("What was wrong with the request, as a sentence"),
});
export interface RunRefusalSchema extends Named<typeof runRefusalSchemaDefinition> {}
export const runRefusalSchema: RunRefusalSchema = runRefusalSchemaDefinition;

const listRunsResponseSchemaDefinition = z.object({
  experimentId: z.string(),
  experimentSlug: z.string(),
  runs: z.array(runListEntrySchema),
  pagination: paginationSchema,
});
export interface ListRunsResponseSchema extends Named<typeof listRunsResponseSchemaDefinition> {}
export const listRunsResponseSchema: ListRunsResponseSchema = listRunsResponseSchemaDefinition;

/**
 * What a completed run tallied, as the poll endpoint reports it: the engine's
 * `ExecutionSummary` plus the per-target/evaluator breakdown a CI job prints.
 * The Redis run-state object, NOT the ClickHouse aggregate in {@link runAggregateSummarySchema}.
 */
const executionSummarySchemaDefinition = z.object({
  runId: z.string(),
  totalCells: z.number().describe("Cells the run set out to execute"),
  completedCells: z.number(),
  failedCells: z.number(),
  duration: z.number().describe("Wall-clock milliseconds"),
  chDispatchFailures: z
    .number()
    .optional()
    .describe("Non-zero means some rows may be missing from the stored results"),
  timestamps: z.object({
    startedAt: z.number(),
    finishedAt: z.number().optional(),
    stoppedAt: z.number().optional(),
  }),
  targets: z
    .array(
      z.object({
        targetId: z.string(),
        name: z.string(),
        passed: z.number(),
        failed: z.number(),
        avgLatency: z.number(),
        totalCost: z.number(),
      }),
    )
    .optional(),
  evaluators: z
    .array(
      z.object({
        evaluatorId: z.string(),
        name: z.string(),
        passed: z.number(),
        failed: z.number(),
        passRate: z.number(),
        avgScore: z.number().optional(),
      }),
    )
    .optional(),
  totalPassed: z.number().optional(),
  totalFailed: z.number().optional(),
  passRate: z.number().optional(),
  totalCost: z.number().optional(),
  runUrl: z.string().optional().describe("Link to the run in the LangWatch app"),
});
export interface ExecutionSummarySchema extends Named<typeof executionSummarySchemaDefinition> {}
export const executionSummarySchema: ExecutionSummarySchema = executionSummarySchemaDefinition;

/**
 * The poll response. Which fields are present depends on `status`: a run
 * still going carries progress only; a finished one adds `finishedAt` and
 * either a `summary` or the failure's stable `error` code.
 */
const runStatusResponseSchemaDefinition = z.object({
  runId: z.string(),
  status: runStatusSchema,
  progress: z.number().describe("Cells finished so far"),
  total: z.number().describe("Cells in the run"),
  startedAt: z.number().optional().describe("Unix milliseconds"),
  finishedAt: z
    .number()
    .optional()
    .describe("Unix milliseconds; set once the run is no longer running"),
  summary: executionSummarySchema.optional().describe("Present when completed"),
  error: z
    .string()
    .optional()
    .describe(
      "Stable failure code, present when failed. Not display copy: render your own wording keyed on it.",
    ),
  domainError: handledErrorSchema
    .optional()
    .describe("The full failure envelope, when the failure carried one"),
  traceId: z
    .string()
    .optional()
    .describe("Trace id for failures that carry no code, to quote in support"),
});
export interface RunStatusResponseSchema extends Named<typeof runStatusResponseSchemaDefinition> {}
export const runStatusResponseSchema: RunStatusResponseSchema = runStatusResponseSchemaDefinition;

const datasetEntrySchema = z.object({
  index: z.number(),
  targetId: z.string().nullable().optional(),
  entry: z.record(z.string(), z.unknown()),
  predicted: z.record(z.string(), z.unknown()).optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z
    .string()
    .nullable()
    .optional()
    .describe("The engine's own string. Prefer domainError.code to branch on"),
  domainError: handledErrorSchema
    .optional()
    .describe("Set on rows written since failures started carrying codes"),
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

/** What the run executed against — a prompt, an agent, an evaluator. */
const runTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  promptId: z.string().nullable().optional(),
  promptVersion: z.number().nullable().optional(),
  agentId: z.string().nullable().optional(),
  evaluatorId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
});

const runResultsResponseSchemaDefinition = z.object({
  experimentId: z.string(),
  runId: z.string(),
  projectId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  progress: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  targets: z
    .array(runTargetSchema)
    .nullable()
    .optional()
    .describe("Resolves the targetId each dataset row and evaluation carries"),
  dataset: z
    .array(datasetEntrySchema)
    .describe("One row per dataset entry, with what the target predicted"),
  evaluations: z.array(evaluationResultSchema).describe("One row per evaluator per dataset entry"),
  timestamps: runTimestampsSchema,
  completeness: experimentRunCompletenessSchema.describe(
    "What is stored against what the run reported. Results are stored after they are reported, so a read can hold part of a run: `complete` is false until the run has ended and every reported row and evaluation is stored. `expected` is null when the run reported no counts",
  ),
});
export interface RunResultsResponseSchema extends Named<
  typeof runResultsResponseSchemaDefinition
> {}
export const runResultsResponseSchema: RunResultsResponseSchema =
  runResultsResponseSchemaDefinition;

// ── workbench state and version history ─────────────────────────────────────

/**
 * The workbench setup as the API carries it. Deliberately open to avoid duplicating the
 * canonical shape; the contract is: read, edit, send back whole.
 */
const workbenchStateSchemaDefinition = z
  .record(z.string(), z.unknown())
  .describe(
    "The experiment setup: datasets, targets and evaluators. Read it, change it, send it back whole.",
  );
export interface WorkbenchStateSchema extends Named<typeof workbenchStateSchemaDefinition> {}
export const workbenchStateSchema: WorkbenchStateSchema = workbenchStateSchemaDefinition;

const createExperimentBodySchemaDefinition = z.object({
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Name for the experiment. A draft name is picked when omitted."),
  state: workbenchStateSchema
    .optional()
    .describe("Setup to start from. Omit for a blank workbench with one inline dataset."),
});
export interface CreateExperimentBodySchema extends Named<
  typeof createExperimentBodySchemaDefinition
> {}
export const createExperimentBodySchema: CreateExperimentBodySchema =
  createExperimentBodySchemaDefinition;

const createExperimentResponseSchemaDefinition = z.object({
  id: z.string().describe("Identifier of the created experiment"),
  slug: z.string().describe("Slug to address the experiment by"),
  version: z.number().describe("Version of the saved setup, starting at 1"),
});
export interface CreateExperimentResponseSchema extends Named<
  typeof createExperimentResponseSchemaDefinition
> {}
export const createExperimentResponseSchema: CreateExperimentResponseSchema =
  createExperimentResponseSchemaDefinition;

const workbenchStateResponseSchemaDefinition = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string().nullable(),
  state: workbenchStateSchema.nullable(),
  version: z.number().int().describe("Send this back as expectedVersion to save safely"),
  updatedAt: z.string().describe("ISO 8601 timestamp of the last save"),
});
export interface WorkbenchStateResponseSchema extends Named<
  typeof workbenchStateResponseSchemaDefinition
> {}
export const workbenchStateResponseSchema: WorkbenchStateResponseSchema =
  workbenchStateResponseSchemaDefinition;

/** What `?fields=version` answers: the staleness probe without the setup. */
const workbenchVersionProbeResponseSchemaDefinition = z.object({
  id: z.string(),
  slug: z.string(),
  version: z.number().int(),
  updatedAt: z.string().describe("ISO 8601 timestamp of the last save"),
});
export interface WorkbenchVersionProbeResponseSchema extends Named<
  typeof workbenchVersionProbeResponseSchemaDefinition
> {}
export const workbenchVersionProbeResponseSchema: WorkbenchVersionProbeResponseSchema =
  workbenchVersionProbeResponseSchemaDefinition;

/** The read's one answer: `?fields=version` leaves out the name and the setup. */
const workbenchStateAnswerSchemaDefinition = workbenchStateResponseSchema.partial({
  name: true,
  state: true,
});
export interface WorkbenchStateAnswerSchema extends Named<
  typeof workbenchStateAnswerSchemaDefinition
> {}
export const workbenchStateAnswerSchema: WorkbenchStateAnswerSchema =
  workbenchStateAnswerSchemaDefinition;

const saveWorkbenchStateBodySchemaDefinition = z.object({
  state: workbenchStateSchema.describe("The full setup to save"),
  expectedVersion: z
    .number()
    .int()
    .optional()
    .describe(
      "The version you read. Sending it refuses the save when someone else already wrote on top of it.",
    ),
  commitMessage: z.string().optional().describe("Names this version in the history list"),
});
export interface SaveWorkbenchStateBodySchema extends Named<
  typeof saveWorkbenchStateBodySchemaDefinition
> {}
export const saveWorkbenchStateBodySchema: SaveWorkbenchStateBodySchema =
  saveWorkbenchStateBodySchemaDefinition;

const saveWorkbenchStateResponseSchemaDefinition = z.object({
  version: z.number().int().describe("The version the save produced"),
});
export interface SaveWorkbenchStateResponseSchema extends Named<
  typeof saveWorkbenchStateResponseSchemaDefinition
> {}
export const saveWorkbenchStateResponseSchema: SaveWorkbenchStateResponseSchema =
  saveWorkbenchStateResponseSchemaDefinition;

const workbenchVersionSchema = z.object({
  version: z
    .number()
    .int()
    .describe(
      "Restore this version by this number. Named versions run 1, 2, 3 with no gaps. The autosave row also has a number, but it changes with every save, so read it as a handle and not as a place in the history.",
    ),
  counterVersion: z
    .number()
    .int()
    .describe(
      "The setup version this row was written at. It says how recent the row is, and it equals the experiment's current version on the row holding the live setup.",
    ),
  autoSaved: z
    .boolean()
    .describe("True for the single autosave row, which every ordinary save rewrites in place"),
  commitMessage: z.string().nullable(),
  authorLabel: z.string().describe("Who wrote it: user, langy or api").meta({ example: "user" }),
  authorId: z.string().nullable().describe("User id, when a person wrote it"),
  createdAt: z.string().describe("ISO 8601 timestamp of the first write"),
  updatedAt: z
    .string()
    .describe(
      "ISO 8601 timestamp of the last write. The autosave row is rewritten in place, so this is what says how old its content is.",
    ),
});

const listWorkbenchVersionsResponseSchemaDefinition = z.object({
  versions: z.array(workbenchVersionSchema).describe("Newest first, by `counterVersion`"),
  nextCursor: z
    .number()
    .int()
    .nullable()
    .describe("Pass as `cursor` to read the next page, null on the last one"),
});
export interface ListWorkbenchVersionsResponseSchema extends Named<
  typeof listWorkbenchVersionsResponseSchemaDefinition
> {}
export const listWorkbenchVersionsResponseSchema: ListWorkbenchVersionsResponseSchema =
  listWorkbenchVersionsResponseSchemaDefinition;

/** A restore takes no body: the version travels in the path. */
const restoreWorkbenchVersionBodySchemaDefinition = z.object({});
export interface RestoreWorkbenchVersionBodySchema extends Named<
  typeof restoreWorkbenchVersionBodySchemaDefinition
> {}
export const restoreWorkbenchVersionBodySchema: RestoreWorkbenchVersionBodySchema =
  restoreWorkbenchVersionBodySchemaDefinition;

const restoreWorkbenchVersionResponseSchemaDefinition = z.object({
  version: z
    .number()
    .describe(
      "The new version the restore wrote. History is never rewritten, so the restored version is still in the list.",
    ),
});
export interface RestoreWorkbenchVersionResponseSchema extends Named<
  typeof restoreWorkbenchVersionResponseSchemaDefinition
> {}
export const restoreWorkbenchVersionResponseSchema: RestoreWorkbenchVersionResponseSchema =
  restoreWorkbenchVersionResponseSchemaDefinition;

const experimentInitResponseSchemaDefinition = z.object({
  slug: z.string().describe("Slug of the experiment, created or existing"),
  path: z.string().describe("Path to the experiment in the LangWatch app"),
});
export interface ExperimentInitResponseSchema extends Named<
  typeof experimentInitResponseSchemaDefinition
> {}
export const experimentInitResponseSchema: ExperimentInitResponseSchema =
  experimentInitResponseSchemaDefinition;

/**
 * The two 400s the create call answers with, hand-rolled rather than raised
 * as handled errors: a body that is not JSON answers `message`, one that
 * parses but fails the schema answers `error` with the validation sentence.
 */
const experimentInitBadRequestSchemaDefinition = z.union([
  z.object({
    message: z.string().describe("Set when the body was not valid JSON"),
  }),
  z.object({
    error: z
      .string()
      .describe(
        "The validation failure as a sentence, not a code: neither identifier was supplied, or a field had the wrong type",
      ),
  }),
]);
export interface ExperimentInitBadRequestSchema extends Named<
  typeof experimentInitBadRequestSchemaDefinition
> {}
export const experimentInitBadRequestSchema: ExperimentInitBadRequestSchema =
  experimentInitBadRequestSchemaDefinition;

/**
 * What a refused create call sends. Two 403 refusals: API key permission denied or plan
 * experiment limit. `error` code distinguishes them; limit case carries counts.
 */
const experimentInitForbiddenSchemaDefinition = handledErrorEnvelopeSchema.safeExtend({
  limitType: z
    .string()
    .optional()
    .describe("Which plan limit was reached, on resource_limit_exceeded"),
  current: z.number().optional().describe("Experiments already in use"),
  max: z.number().optional().describe("What the plan allows"),
});
export interface ExperimentInitForbiddenSchema extends Named<
  typeof experimentInitForbiddenSchemaDefinition
> {}
export const experimentInitForbiddenSchema: ExperimentInitForbiddenSchema =
  experimentInitForbiddenSchemaDefinition;

/** A run whose progress the caller follows as it happens. */
export type WorkbenchRunStream = Readonly<{
  kind: "streaming";
  events: AsyncIterable<EvaluationV3Event>;
}>;

export type WorkbenchRunAnswer = WorkbenchRunStream;

export type SavedRunAnswer =
  | WorkbenchRunAnswer
  | (Readonly<{ kind: "started" }> & z.infer<typeof startRunResponseSchema>);

export type SavedRunRequest = Readonly<{
  projectId: string;
  projectSlug: string;
  slug: string;
  body: string;
  acceptsEvents: boolean;
  credential: WorkbenchCredential;
}>;

export type RunsPageRequest = Readonly<{ projectId: string }> & z.infer<typeof listRunsQuerySchema>;

export type RunsPageAnswer =
  | Readonly<{ status: 400; body: z.infer<typeof runRefusalSchema> }>
  | Readonly<{ status: 200; body: z.infer<typeof listRunsResponseSchema> }>;

export type RunStatusAnswer = z.infer<typeof runStatusResponseSchema>;

export type RunResultsRequest = Readonly<{ projectId: string; runId: string }> &
  z.infer<typeof runResultsQuerySchema>;

export type WorkbenchStateAnswer = z.infer<typeof workbenchStateAnswerSchema>;

export type WorkbenchVersionsAnswer = z.infer<typeof listWorkbenchVersionsResponseSchema>;

export type WorkbenchSavedVersion = z.infer<typeof saveWorkbenchStateResponseSchema>;

export type WorkbenchStateBySlugRequest = Readonly<{ projectId: string; slug: string }> &
  z.infer<typeof workbenchStateQuerySchema>;

export type WorkbenchVersionsBySlugRequest = Readonly<{ projectId: string; slug: string }> &
  z.infer<typeof listVersionsQuerySchema>;

export type SaveWorkbenchStateBySlugRequest = Readonly<{ projectId: string; slug: string }> &
  z.infer<typeof saveWorkbenchStateBodySchema>;
