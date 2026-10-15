import type { Named } from "@langwatch/module";
import {
  evaluatorAttachmentSchema,
  MAX_EVALUATOR_ATTACHMENTS,
  runNoteSchema,
  runParameterValuesSchema,
  scenarioMappingSchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

import { MAX_PLAN_NAME_LENGTH } from "./plan-name.ts";
import { suiteScopeSchema } from "./suite.scope.ts";
import { MAX_REPEAT_COUNT, suiteTargetSchema } from "./suite.ts";

/** What a query string may say for yes and for no. Compared case-folded. */
const QUERY_BOOLEAN_TRUE = ["true", "1", "yes"];
const QUERY_BOOLEAN_FALSE = ["false", "0", "no", ""];

/**
 * A boolean spelled in a query string.
 */
export const queryBoolean = z
  .string()
  .optional()
  .default("false")
  .transform((raw, ctx): boolean | typeof z.NEVER => {
    const spelling = raw.toLowerCase();
    if (QUERY_BOOLEAN_TRUE.includes(spelling)) return true;
    if (QUERY_BOOLEAN_FALSE.includes(spelling)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `must be one of ${[...QUERY_BOOLEAN_TRUE, ...QUERY_BOOLEAN_FALSE.filter(Boolean)].join(", ")}`,
    });
    return z.NEVER;
  })
  .describe(
    `${QUERY_BOOLEAN_TRUE.join(", ")} for yes; ${QUERY_BOOLEAN_FALSE.filter(Boolean).join(", ")} or omitted for no.`,
  );

/** The run plan a `/run-plans/:id` route addresses. */
const runPlanIdParamsSchemaDefinition = z.object({
  id: z.string().min(1).describe("The run plan id."),
});
export interface RunPlanIdParamsSchema extends Named<typeof runPlanIdParamsSchemaDefinition> {}
export const runPlanIdParamsSchema: RunPlanIdParamsSchema = runPlanIdParamsSchemaDefinition;

const runPlanListQuerySchemaDefinition = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived run plans in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});
export interface RunPlanListQuerySchema extends Named<typeof runPlanListQuerySchemaDefinition> {}
export const runPlanListQuerySchema: RunPlanListQuerySchema = runPlanListQuerySchemaDefinition;

const runPlanArchiveResultSchemaDefinition = z.object({
  id: z.string().describe("The run plan that was archived."),
  archived: z.literal(true).describe("Always true once the plan is archived."),
});
export interface RunPlanArchiveResultSchema extends Named<
  typeof runPlanArchiveResultSchemaDefinition
> {}
export const runPlanArchiveResultSchema: RunPlanArchiveResultSchema =
  runPlanArchiveResultSchemaDefinition;

/** The test suite a `/test-suites/:id` route addresses. */
const testSuiteIdParamsSchemaDefinition = z.object({
  id: z.string().min(1).describe("The test suite id."),
});
export interface TestSuiteIdParamsSchema extends Named<typeof testSuiteIdParamsSchemaDefinition> {}
export const testSuiteIdParamsSchema: TestSuiteIdParamsSchema = testSuiteIdParamsSchemaDefinition;

const testSuiteListQuerySchemaDefinition = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived test suites in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});
export interface TestSuiteListQuerySchema extends Named<
  typeof testSuiteListQuerySchemaDefinition
> {}
export const testSuiteListQuerySchema: TestSuiteListQuerySchema =
  testSuiteListQuerySchemaDefinition;

const testSuiteArchiveResultSchemaDefinition = z.object({
  id: z.string().describe("The test suite that was archived."),
  archived: z.literal(true).describe("Always true once the suite is archived."),
});
export interface TestSuiteArchiveResultSchema extends Named<
  typeof testSuiteArchiveResultSchemaDefinition
> {}
export const testSuiteArchiveResultSchema: TestSuiteArchiveResultSchema =
  testSuiteArchiveResultSchemaDefinition;

/** What a run plan covers, in the words this family was published with. */
const wireScopeSchemaDefinition = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
    z.object({ mode: z.literal("folders"), folderIds: z.array(z.string()) }),
    z.object({ mode: z.literal("labels"), labels: z.array(z.string()) }),
    z.object({ mode: z.literal("cases") }),
  ])
  .describe(
    "What the run plan covers: all (every active scenario), folders (the scenarios filed in the named test suites), labels (the scenarios carrying any of the labels), or cases (the scenarioIds below). A dynamic scope is resolved again at every run, so a scenario written later runs without editing the plan.",
  );
export interface WireScopeSchema extends Named<typeof wireScopeSchemaDefinition> {}
export const wireScopeSchema: WireScopeSchema = wireScopeSchemaDefinition;

export type WireScope = z.infer<typeof wireScopeSchema>;

/**
 * The suite as this family answers it. `kind` and `scope` are optional in
 * the document, not the answer: every server sends both, since clients
 * generated before they existed would fail reading them as required.
 * @see specs/api-reference/legacy-response-fields-optional.feature
 */
const suiteResponseSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z
    .enum(["custom", "folder"])
    .optional()
    .describe(
      "custom is a hand-assembled run plan; folder is a test suite that groups scenarios filed into it. Absent on servers that predate test suites.",
    ),
  description: z.string().nullable(),
  scenarioIds: z.array(z.string()),
  scope: wireScopeSchema.nullable().optional(),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export interface SuiteResponseSchema extends Named<typeof suiteResponseSchemaDefinition> {}
export const suiteResponseSchema: SuiteResponseSchema = suiteResponseSchemaDefinition;

const suiteResponseWithPlatformUrlSchemaDefinition = z.object({
  ...suiteResponseSchema.shape,
  platformUrl: z.string().url(),
});
export interface SuiteResponseWithPlatformUrlSchema extends Named<
  typeof suiteResponseWithPlatformUrlSchemaDefinition
> {}
export const suiteResponseWithPlatformUrlSchema: SuiteResponseWithPlatformUrlSchema =
  suiteResponseWithPlatformUrlSchemaDefinition;

/** What a create body carries, before either kind's guards are applied. */
export type CreateSuiteBody = {
  kind: "custom" | "folder";
  scope?: { mode: string };
  scenarioIds: string[];
  targets: unknown[];
};

/**
 * A test suite is created empty by definition, so a scope, a member list and a
 * target list are refused rather than silently dropped.
 */
export function refuseTestSuiteExtras(body: CreateSuiteBody, ctx: z.RefinementCtx): void {
  if (body.scope) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scope"],
      message: "A test suite runs the scenarios filed in it, so it takes no scope",
    });
  }
  if (body.scenarioIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioIds"],
      message: "A test suite is created empty; file scenarios into it after creating it",
    });
  }
  if (body.targets.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targets"],
      message: "A test suite gets its targets when a run is started",
    });
  }
}

/** A run plan states what it runs and what it runs against. */
export function refusePlanGaps(body: CreateSuiteBody, ctx: z.RefinementCtx): void {
  const picksCases = !body.scope || body.scope.mode === "cases";
  if (picksCases && body.scenarioIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioIds"],
      message: "At least one scenario is required",
    });
  }
  if (body.targets.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targets"],
      message: "At least one target is required",
    });
  }
}

/**
 * One create schema for both kinds; a body naming no kind is a custom run
 * plan and keeps the historical at-least-one guards. Strict, so a field this
 * endpoint does not have (`schedule`, `cron`) is refused by name, not dropped.
 */
const createSuiteInputSchemaDefinition = z
  .object({
    name: z.string().min(1, "name is required"),
    kind: z
      .enum(["custom", "folder"])
      .default("custom")
      .describe(
        "custom (the default) is a run plan and needs scenarioIds and targets; folder is a test suite that starts empty and gets scenarios by filing them into it.",
      ),
    description: z.string().optional(),
    scenarioIds: z.array(z.string()).default([]),
    scope: wireScopeSchema.optional(),
    targets: z.array(suiteTargetSchema).default([]),
    repeatCount: z.number().int().min(1).max(100).default(1),
    labels: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.kind === "folder") {
      refuseTestSuiteExtras(body, ctx);

      return;
    }
    refusePlanGaps(body, ctx);
  });
export interface CreateSuiteInputSchema extends Named<typeof createSuiteInputSchemaDefinition> {}
export const createSuiteInputSchema: CreateSuiteInputSchema = createSuiteInputSchemaDefinition;

const listSuitesQuerySchemaDefinition = z.object({
  kind: z
    .enum(["custom", "folder"])
    .default("custom")
    .describe(
      "Which kind of suite to list. Defaults to custom, so callers that predate test suites keep seeing exactly the run plans they always did.",
    ),
});
export interface ListSuitesQuerySchema extends Named<typeof listSuitesQuerySchemaDefinition> {}
export const listSuitesQuerySchema: ListSuitesQuerySchema = listSuitesQuerySchemaDefinition;

const updateSuiteInputSchemaDefinition = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scope: wireScopeSchema.optional(),
  scenarioIds: z.array(z.string()).min(1).optional(),
  targets: z.array(suiteTargetSchema).min(1).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
});
export interface UpdateSuiteInputSchema extends Named<typeof updateSuiteInputSchemaDefinition> {}
export const updateSuiteInputSchema: UpdateSuiteInputSchema = updateSuiteInputSchemaDefinition;

const runSuiteInputSchemaDefinition = z.object({
  idempotencyKey: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .optional()
    .describe(
      "The run plan this run joins or creates. Used only when the id names a test suite; derived from the suite name and the targets when absent.",
    ),
  targets: z
    .array(suiteTargetSchema)
    .optional()
    .describe(
      "The prompts, agents or workflows the run goes against. Read only when the id names a test suite, which stores no target of its own; a run plan already holds its own and refuses these.",
    ),
  repeatCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_REPEAT_COUNT)
    .optional()
    .describe(
      `How many times each scenario and target pairing runs, between 1 and ${MAX_REPEAT_COUNT}. Used only when the id names a test suite.`,
    ),
  simulatorModel: z
    .string()
    .nullish()
    .describe(
      "The model that plays the user for every scenario in the run. Used only when the id names a test suite.",
    ),
  judgeModel: z
    .string()
    .nullish()
    .describe(
      "The model that judges every scenario in the run. Used only when the id names a test suite.",
    ),
  parameters: runParameterValuesSchema
    .optional()
    .describe(
      "Constant values applied to every scenario in the run, e.g. a fixture id or a tenant. A value supplied here overrides the scenario's own default for that name.",
    ),
  note: runNoteSchema.describe(
    "One short line describing why this batch was run, e.g. a commit hash or what you changed. It is stored on every run of the batch and shown beside the run in the platform. Up to 200 characters.",
  ),
});
export interface RunSuiteInputSchema extends Named<typeof runSuiteInputSchemaDefinition> {}
export const runSuiteInputSchema: RunSuiteInputSchema = runSuiteInputSchemaDefinition;

const suiteRunResultSchemaDefinition = z.object({
  scheduled: z.boolean(),
  batchRunId: z.string(),
  setId: z.string(),
  jobCount: z.number(),
  skippedArchived: z.object({
    scenarios: z.array(z.string()),
    targets: z.array(z.string()),
  }),
  items: z.array(
    z.object({
      scenarioRunId: z.string(),
      scenarioId: z.string(),
      target: suiteTargetSchema,
      name: z.string().nullable(),
    }),
  ),
  // Only a test-suite run files itself under a run plan, so only that half of
  // the alias answers with the plan it reached. Undeclared, the pipeline
  // strips both from the body the caller was answered with on main.
  planName: z.string().optional(),
  created: z.boolean().optional(),
  planSlug: z.string(),
});
export interface SuiteRunResultSchema extends Named<typeof suiteRunResultSchemaDefinition> {}
export const suiteRunResultSchema: SuiteRunResultSchema = suiteRunResultSchemaDefinition;

const suiteAliasIdParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface SuiteAliasIdParamsSchema extends Named<
  typeof suiteAliasIdParamsSchemaDefinition
> {}
export const suiteAliasIdParamsSchema: SuiteAliasIdParamsSchema =
  suiteAliasIdParamsSchemaDefinition;

/** A duplicate takes no body: the source suite travels in the path. */
const duplicateSuiteBodySchemaDefinition = z.object({});
export interface DuplicateSuiteBodySchema extends Named<
  typeof duplicateSuiteBodySchemaDefinition
> {}
export const duplicateSuiteBodySchema: DuplicateSuiteBodySchema =
  duplicateSuiteBodySchemaDefinition;
const archivedSuiteSchemaDefinition = z.object({ id: z.string(), archived: z.boolean() });
export interface ArchivedSuiteSchema extends Named<typeof archivedSuiteSchemaDefinition> {}
export const archivedSuiteSchema: ArchivedSuiteSchema = archivedSuiteSchemaDefinition;

const scenarioMappingWireSchemaDefinition = scenarioMappingSchema.describe(
  "Where one evaluator input reads its value. A source mapping names conversation (first_user_message, last_agent_message, transcript, messages), scenario (situation, criteria, or fields followed by a field identifier) or trace (contexts, spans, or tool_calls followed by a tool name and input or output). A value mapping is a literal.",
);
export interface ScenarioMappingWireSchema extends Named<
  typeof scenarioMappingWireSchemaDefinition
> {}
export const scenarioMappingWireSchema: ScenarioMappingWireSchema =
  scenarioMappingWireSchemaDefinition;

const evaluatorAttachmentWireSchemaDefinition = z
  .object({
    ...evaluatorAttachmentSchema.shape,
    mappings: z
      .record(z.string().min(1).max(128), scenarioMappingWireSchema)
      .describe(
        "Where each evaluator input reads its value, keyed by input name. Inputs left out are unmapped; a required input left unmapped refuses the run.",
      ),
  })
  .describe(
    "One evaluator that runs after every scenario run, with where each of its inputs reads from.",
  );
export interface EvaluatorAttachmentWireSchema extends Named<
  typeof evaluatorAttachmentWireSchemaDefinition
> {}
export const evaluatorAttachmentWireSchema: EvaluatorAttachmentWireSchema =
  evaluatorAttachmentWireSchemaDefinition;

const evaluatorAttachmentsWireSchemaDefinition = z
  .array(evaluatorAttachmentWireSchema)
  .max(MAX_EVALUATOR_ATTACHMENTS)
  .describe(
    `The evaluators that run after every scenario run. Up to ${MAX_EVALUATOR_ATTACHMENTS}. A required evaluator that fails fails the scenario; a score-only evaluator reports and never gates.`,
  );
export interface EvaluatorAttachmentsWireSchema extends Named<
  typeof evaluatorAttachmentsWireSchemaDefinition
> {}
export const evaluatorAttachmentsWireSchema: EvaluatorAttachmentsWireSchema =
  evaluatorAttachmentsWireSchemaDefinition;

/** What a run plan covers. */
const runPlanScopeSchemaDefinition = suiteScopeSchema.describe(
  "What the run plan covers: all (every active scenario), test_suites (the scenarios filed in the named test suites), labels (the scenarios carrying any of the labels), or scenarios (the scenarioIds sent with the configuration). A dynamic scope is resolved again at every run, so a scenario written later runs without editing the plan.",
);
export interface RunPlanScopeSchema extends Named<typeof runPlanScopeSchemaDefinition> {}
export const runPlanScopeSchema: RunPlanScopeSchema = runPlanScopeSchemaDefinition;

/** One run plan, as the API publishes it. */
const runPlanWireSchemaDefinition = z.object({
  id: z.string().describe("The run plan id."),
  name: z
    .string()
    .describe(
      "The run plan name. This is the plan's identity: a run started under this name joins this plan.",
    ),
  slug: z
    .string()
    .describe(
      "The plan's address in the platform. It is kept when the plan is renamed, so run history never moves.",
    ),
  scope: runPlanScopeSchema,
  scenarioIds: z.array(z.string()).describe("The scenarios the last run of this plan covered."),
  targets: z
    .array(suiteTargetSchema)
    .describe(
      "What the plan runs against, in the order the results show. A target carrying runParameters runs with those values.",
    ),
  repeatCount: z.number().describe("How many times each scenario and target pairing runs."),
  simulatorModel: z
    .string()
    .nullable()
    .describe("The model that plays the user, or null for the scenario or project default."),
  judgeModel: z
    .string()
    .nullable()
    .describe("The model that judges the run, or null for the scenario or project default."),
  labels: z.array(z.string()).describe("The labels the plan carries."),
  evaluators: evaluatorAttachmentsWireSchema
    .optional()
    .describe(
      "The plan's own evaluators. Absent on servers that predate evaluators on this family.",
    ),
  archivedAt: z
    .string()
    .nullable()
    .describe("When the plan was archived, or null while it is active."),
  createdAt: z.string().describe("When the plan was created."),
  updatedAt: z.string().describe("When the plan was last written."),
  platformUrl: z.string().url().describe("Where to open this run plan in the LangWatch platform."),
});
export interface RunPlanWireSchema extends Named<typeof runPlanWireSchemaDefinition> {}
export const runPlanWireSchema: RunPlanWireSchema = runPlanWireSchemaDefinition;

export type RunPlanWire = z.infer<typeof runPlanWireSchema>;
