import { runNoteSchema, runParameterValuesSchema } from "@langwatch/scenario-contract";
import { z } from "zod";

import { MAX_PLAN_NAME_LENGTH } from "./plan-name.ts";
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
export const runPlanIdParamsSchema = z.object({
  id: z.string().min(1).describe("The run plan id."),
});

export const runPlanListQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived run plans in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

export const runPlanArchiveResultSchema = z.object({
  id: z.string().describe("The run plan that was archived."),
  archived: z.literal(true).describe("Always true once the plan is archived."),
});

/** The test suite a `/test-suites/:id` route addresses. */
export const testSuiteIdParamsSchema = z.object({
  id: z.string().min(1).describe("The test suite id."),
});

export const testSuiteListQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived test suites in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

export const testSuiteArchiveResultSchema = z.object({
  id: z.string().describe("The test suite that was archived."),
  archived: z.literal(true).describe("Always true once the suite is archived."),
});

/** What a run plan covers, in the words this family was published with. */
export const wireScopeSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
    z.object({ mode: z.literal("folders"), folderIds: z.array(z.string()) }),
    z.object({ mode: z.literal("labels"), labels: z.array(z.string()) }),
    z.object({ mode: z.literal("cases") }),
  ])
  .describe(
    "What the run plan covers: all (every active scenario), folders (the scenarios filed in the named test suites), labels (the scenarios carrying any of the labels), or cases (the scenarioIds below). A dynamic scope is resolved again at every run, so a scenario written later runs without editing the plan.",
  );

export type WireScope = z.infer<typeof wireScopeSchema>;

/**
 * The suite as this family answers it. `kind` and `scope` are optional in
 * the document, not the answer: every server sends both, since clients
 * generated before they existed would fail reading them as required.
 * @see specs/api-reference/legacy-response-fields-optional.feature
 */
export const suiteResponseSchema = z.object({
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

export const suiteResponseWithPlatformUrlSchema = z.object({
  ...suiteResponseSchema.shape,
  platformUrl: z.string().url(),
});

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
 * One create schema for both kinds, with the guards conditional on kind: a
 * body naming no kind is a custom run plan and keeps the historical
 * at-least-one guards.
 */
export const createSuiteInputSchema = z
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
  .superRefine((body, ctx) => {
    if (body.kind === "folder") {
      refuseTestSuiteExtras(body, ctx);

      return;
    }
    refusePlanGaps(body, ctx);
  });

export const listSuitesQuerySchema = z.object({
  kind: z
    .enum(["custom", "folder"])
    .default("custom")
    .describe(
      "Which kind of suite to list. Defaults to custom, so callers that predate test suites keep seeing exactly the run plans they always did.",
    ),
});

export const updateSuiteInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scope: wireScopeSchema.optional(),
  scenarioIds: z.array(z.string()).min(1).optional(),
  targets: z.array(suiteTargetSchema).min(1).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
});

export const runSuiteInputSchema = z.object({
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

export const suiteRunResultSchema = z.object({
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
});

export const suiteAliasIdParamsSchema = z.object({ id: z.string().min(1) });

/** A duplicate takes no body: the source suite travels in the path. */
export const duplicateSuiteBodySchema = z.object({});
export const archivedSuiteSchema = z.object({ id: z.string(), archived: z.boolean() });
