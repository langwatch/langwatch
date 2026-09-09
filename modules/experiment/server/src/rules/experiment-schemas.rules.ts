/**
 * OpenAPI schemas for the API-key half of the experiments REST surface.
 *
 * Only the routes an integrator calls with a project API key live here: the
 * create call (`POST /api/experiment/init`, registered over in `misc.ts`), the
 * run trigger, and the three read endpoints. `execute` and `abort`
 * authenticate with a browser session and belong to the workbench UI, so they
 * are not described and do not reach the published document.
 *
 * These describe responses the handlers already send. They do not validate
 * anything at runtime; the handlers keep their own parsing.
 */

import { z } from "zod";

/** Run lifecycle as the poll endpoint reports it. */
export const runStatusSchema = z.enum(["pending", "running", "completed", "failed", "stopped"]);

const paginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  totalHits: z.number(),
  hasMore: z.boolean(),
});

/**
 * What the REST boundary sends when a route throws a `HandledError`.
 *
 * `handledErrorResponseBody` builds `{ error: code, message }` and then spreads
 * the error's `meta` at the TOP level, plus `tips` / `docsUrl` / `fault` /
 * `reasons` when present — so this is deliberately open: `meta`'s keys differ
 * per code and arrive as siblings of `error`, not nested under it.
 *
 * `error` carries the stable code, not prose. Branch on it; write the words a
 * customer reads from your own registry keyed on that code (ADR-045).
 */
export const handledErrorEnvelopeSchema = z
  .object({
    error: z.string().describe("Stable failure code; branch on this"),
    message: z.string().optional(),
    fault: z
      .string()
      .optional()
      .describe("Who the failure is attributable to: customer, platform, provider"),
    tips: z.array(z.string()).optional(),
    docsUrl: z.string().optional(),
  })
  .passthrough();

/**
 * The 409 a workbench write answers with when someone else saved first.
 *
 * `StaleWorkbenchStateError` carries `currentVersion` in `meta`, and the REST
 * boundary spreads `meta` flat, so the number arrives as a sibling of `error`.
 * It is declared here because reloading is the whole remedy: a client that
 * reads it can go straight to the current version instead of guessing.
 */
export const staleWorkbenchStateErrorSchema = handledErrorEnvelopeSchema.extend({
  currentVersion: z
    .number()
    .int()
    .describe("The stored version now. Read the setup again at this one."),
});

/**
 * A failure we could name, serialised for a client to branch on (ADR-045).
 *
 * This is the NESTED form, carried as a `domainError` field on a run or a row —
 * distinct from {@link handledErrorEnvelopeSchema}, which is the flat body the
 * boundary returns when the request itself fails.
 *
 * `code` is the stable discriminant and the only field to key logic off.
 * Nothing here is sensitive — that is what makes an error handled — but the
 * copy a customer reads is still yours to write from the code, not `message`.
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
    .describe("Who the failure is attributable to: customer, platform, provider"),
  traceId: z.string().optional(),
  tips: z.array(z.string()).optional(),
  docsUrl: z.string().optional(),
});

export const startRunResponseSchema = z.object({
  runId: z.string().describe("Identifier to poll this run with"),
  status: z.literal("running"),
  total: z.number().describe("Number of cells this run will execute"),
  runUrl: z.string().optional().describe("Link to the run in the LangWatch app"),
});

const evaluationSummarySchema = z.object({
  name: z.string(),
  averageScore: z.number().nullable(),
  averagePassed: z.number().optional(),
});

/**
 * The aggregate a run row carries in the LIST response — costs and durations
 * rolled up per evaluator.
 *
 * Not to be confused with {@link executionSummarySchema}: both are called
 * `summary` on the wire, and they are different objects. This one is
 * `ExperimentRunSummary`, folded from ClickHouse; the other is the live
 * execution's tally, held in Redis for the poll endpoint.
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

export const listRunsResponseSchema = z.object({
  experimentId: z.string(),
  experimentSlug: z.string(),
  runs: z.array(runListEntrySchema),
  pagination: paginationSchema,
});

/**
 * What a completed run tallied, as the poll endpoint reports it: the engine's
 * `ExecutionSummary` plus the per-target and per-evaluator breakdown a CI job
 * prints. This is the run-state object held in Redis, NOT the ClickHouse
 * aggregate of the same name in {@link runAggregateSummarySchema}.
 */
const executionSummarySchema = z.object({
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

export const runResultsResponseSchema = z.object({
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
});

// ── workbench state and version history ─────────────────────────────────────

/**
 * The workbench setup, as the API carries it.
 *
 * Deliberately open: the canonical shape is
 * `persistedEvaluationsV3StateSchema`, which the service parses on every
 * write, and re-declaring its ~40 nested objects here would give integrators a
 * second definition that drifts. What the document promises is the contract
 * that matters: an object you read, edit and send back whole.
 */
export const workbenchStateSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "The experiment setup: datasets, targets and evaluators. Read it, change it, send it back whole.",
  );

export const createExperimentBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Name for the experiment. A draft name is picked when omitted."),
  state: workbenchStateSchema
    .optional()
    .describe("Setup to start from. Omit for a blank workbench with one inline dataset."),
});

export const createExperimentResponseSchema = z.object({
  id: z.string().describe("Identifier of the created experiment"),
  slug: z.string().describe("Slug to address the experiment by"),
  version: z.number().describe("Version of the saved setup, starting at 1"),
});

export const workbenchStateResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string().nullable(),
  state: workbenchStateSchema.nullable(),
  version: z.number().int().describe("Send this back as expectedVersion to save safely"),
  updatedAt: z.string().describe("ISO 8601 timestamp of the last save"),
});

/** What `?fields=version` answers: the staleness probe without the setup. */
export const workbenchVersionProbeResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  version: z.number().int(),
  updatedAt: z.string().describe("ISO 8601 timestamp of the last save"),
});

export const saveWorkbenchStateBodySchema = z.object({
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

export const saveWorkbenchStateResponseSchema = z.object({
  version: z.number().int().describe("The version the save produced"),
});

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

export const listWorkbenchVersionsResponseSchema = z.object({
  versions: z.array(workbenchVersionSchema).describe("Newest first, by `counterVersion`"),
  nextCursor: z
    .number()
    .int()
    .nullable()
    .describe("Pass as `cursor` to read the next page, null on the last one"),
});

export const restoreWorkbenchVersionResponseSchema = z.object({
  version: z
    .number()
    .describe(
      "The new version the restore wrote. History is never rewritten, so the restored version is still in the list.",
    ),
});

export const experimentInitResponseSchema = z.object({
  slug: z.string().describe("Slug of the experiment, created or existing"),
  path: z.string().describe("Path to the experiment in the LangWatch app"),
});

/**
 * The two 400s the create call answers with.
 *
 * They are hand-rolled in the handler rather than raised as handled errors,
 * and they share no field: a body that is not JSON at all answers `message`, a
 * body that parses but fails the schema answers `error` carrying the
 * validation sentence. Documented as sent, so a caller reads the right field.
 */
export const experimentInitBadRequestSchema = z.union([
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

/**
 * What a refused create call sends.
 *
 * Two different refusals share the 403: the API key ceiling denying
 * `experiments:manage`, and the plan's experiment limit. Both arrive in the
 * flat handled-error envelope, so `error` is the code to branch on —
 * `api_key_permission_denied` for the first, `resource_limit_exceeded` for the
 * second, which also carries the counts below.
 */
export const experimentInitForbiddenSchema = handledErrorEnvelopeSchema.extend({
  limitType: z
    .string()
    .optional()
    .describe("Which plan limit was reached, on resource_limit_exceeded"),
  current: z.number().optional().describe("Experiments already in use"),
  max: z.number().optional().describe("What the plan allows"),
});
