import type { Named } from "@langwatch/module";
import {
  evaluatorAttachmentsSchema,
  MAX_PARAMETER_NAME_LENGTH,
  MAX_RUN_PARAMETER_KEYS,
  owaspIdSchema,
  RED_TEAM_DEFAULT_MAX_TURNS,
  RED_TEAM_MAX_TURNS_CAP,
  redTeamStrategySchema,
  runActorSchema,
  runNoteSchema,
  runParameterValuesSchema,
  traceQuietPeriodMsSchema,
  traceWaitTimeoutMsSchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

import { MAX_PLAN_NAME_LENGTH } from "./plan-name.ts";
import { suiteScopeSchema } from "./suite.scope.ts";

/**
 * The kinds of SimulationSuite: "run_plan" is hand-assembled, "test_suite"
 * groups scenarios via `Scenario.testSuiteId`. A string column plus this
 * union, not a Prisma enum — adding a kind must not need a migration.
 */
export const SUITE_KINDS = ["test_suite", "run_plan"] as const;
export const suiteKindSchema = z.enum(SUITE_KINDS);
export type SuiteKind = z.infer<typeof suiteKindSchema>;

export function isSuiteKind(value: string): value is SuiteKind {
  return suiteKindSchema.validate(value);
}

export const RUN_ALL_SUITE_LABEL = "managed:run-all";
export const RUN_ALL_SUITE_NAME = "All test cases";

/**
 * Label the CLI puts on the throwaway plan it makes for `langwatch scenario run`, archived as
 * soon as the run is queued. A plan resolved by name skips these rows: joining one would attach
 * a person's run to a plan about to disappear from every list.
 */
export const CLI_EPHEMERAL_LABEL = "cli-ephemeral";

export const suiteTargetTypeSchema = z.enum([
  "prompt",
  "http",
  "code",
  "workflow",
  // An agent the SDK registered from a decorated function in the customer's
  // own code (ADR-128). Its reference id may also read `<name>@<environment>`,
  // which the run resolves to an agent id before anything is scheduled.
  "connected",
  // A voice agent, reached over a live call rather than a request/response
  // API. The run drives the call and the transcript is what the scenarios
  // judge, so the target resolves to a call destination rather than an
  // endpoint.
  "voice",
  // A Scenario Connector agent (ADR-194): the app runs its call, setup and
  // teardown blocks. The scenario run itself refuses it while the release is off.
  "connector",
]);
export type SuiteTargetType = z.infer<typeof suiteTargetTypeSchema>;

const suiteFieldMappingSchemaDefinition = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("source"),
      sourceId: z.string().min(1),
      path: z.array(z.string()),
    })
    .strict(),
  z.object({ type: z.literal("value"), value: z.string() }).strict(),
]);
export interface SuiteFieldMappingSchema extends Named<typeof suiteFieldMappingSchemaDefinition> {}
export const suiteFieldMappingSchema: SuiteFieldMappingSchema = suiteFieldMappingSchemaDefinition;
export type SuiteFieldMapping = z.infer<typeof suiteFieldMappingSchema>;

const suiteTargetBaseSchema = z
  .object({
    type: suiteTargetTypeSchema,
    referenceId: z.string().min(1),
    scenarioMappings: z.record(z.string(), suiteFieldMappingSchema).optional(),
    runParameters: runParameterValuesSchema.optional(),
    runSecretParameterNames: z
      .array(z.string().max(MAX_PARAMETER_NAME_LENGTH))
      .max(MAX_RUN_PARAMETER_KEYS)
      .optional(),
  })
  .strict();

const suiteTargetSchemaDefinition = suiteTargetBaseSchema.superRefine((target, context) => {
  if (target.type === "prompt" || target.scenarioMappings === undefined) return;
  context.addIssue({
    code: "custom",
    path: ["scenarioMappings"],
    message: `A ${target.type} target cannot carry scenarioMappings.`,
  });
});
export interface SuiteTargetSchema extends Named<typeof suiteTargetSchemaDefinition> {}
export const suiteTargetSchema: SuiteTargetSchema = suiteTargetSchemaDefinition;
export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

/** What a run's ownership check reads about one agent it targets, and nothing more. */
export type ConnectedTargetAgent = {
  id: string;
  name: string;
  type: string;
  ownerUserId?: string | null;
};

/** Browser and transport callers use the same target parser as the service boundary. */
export function parseSuiteTargets(value: unknown): SuiteTarget[] {
  return z.array(suiteTargetSchema).parse(value);
}

/** Keeps the authoring limit aligned with the established suite-run transport. */
export const MAX_SUITE_REPEAT_COUNT = 5;

/** The same limit under the name the run dialog and the plan editor read. */
export const MAX_REPEAT_COUNT = MAX_SUITE_REPEAT_COUNT;

const suiteSchemaDefinition = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    kind: suiteKindSchema,
    description: z.string().nullable(),
    scenarioIds: z.array(z.string()),
    scope: suiteScopeSchema.nullable(),
    targets: z.array(suiteTargetSchema),
    repeatCount: z.number().int().positive(),
    labels: z.array(z.string()),
    simulatorModel: z.string().nullable(),
    judgeModel: z.string().nullable(),
    // The plan-wide judge trace wait in ms; optional so pre-column rows still parse.
    traceQuietPeriodMs: z.number().int().nullish(),
    traceWaitTimeoutMs: z.number().int().nullish(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface SuiteSchema extends Named<typeof suiteSchemaDefinition> {}
export const suiteSchema: SuiteSchema = suiteSchemaDefinition;
export type Suite = z.infer<typeof suiteSchema>;

/**
 * The named values a run carries. The name is bounded in a refinement rather than as
 * `z.string().min(1)` on the key.
 */
const suiteRunParametersSchemaDefinition = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .superRefine((parameters, ctx) => {
    for (const name of Object.keys(parameters)) {
      if (name.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          origin: "string",
          minimum: 1,
          inclusive: true,
          message: "A run parameter must have a name",
        });
      }
    }
  });
export interface SuiteRunParametersSchema extends Named<
  typeof suiteRunParametersSchemaDefinition
> {}
export const suiteRunParametersSchema: SuiteRunParametersSchema =
  suiteRunParametersSchemaDefinition;
export type SuiteRunParameters = z.infer<typeof suiteRunParametersSchema>;

const suiteRunInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    organizationId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    batchRunId: z.string().min(1).optional(),
    parameters: suiteRunParametersSchema.optional(),
    note: runNoteSchema,
    /**
     * Who started the run: a person, the key it was started with, or both. Every run of the batch
     * records it. Absent when the surface names neither.
     * @see specs/scenarios/run-actor-on-runs.feature
     */
    actor: runActorSchema.optional(),
  })
  .strict();
export interface SuiteRunInputSchema extends Named<typeof suiteRunInputSchemaDefinition> {}
export const suiteRunInputSchema: SuiteRunInputSchema = suiteRunInputSchemaDefinition;
export type SuiteRunInput = z.infer<typeof suiteRunInputSchema>;

const suiteRunAllInputSchemaDefinition = suiteRunInputSchema
  .omit({ id: true })
  .safeExtend({ targets: z.array(suiteTargetSchema).optional() })
  .strict();
export interface SuiteRunAllInputSchema extends Named<typeof suiteRunAllInputSchemaDefinition> {}
export const suiteRunAllInputSchema: SuiteRunAllInputSchema = suiteRunAllInputSchemaDefinition;
export type SuiteRunAllInput = z.infer<typeof suiteRunAllInputSchema>;

/**
 * A run plan's config, as a run request carries it: the scope, the targets,
 * the two simulation model overrides, and — for a hand-picked scope only —
 * the scenarios it names.
 */
const runPlanConfigSchemaDefinition = z
  .object({
    scope: suiteScopeSchema,
    targets: z.array(suiteTargetSchema),
    repeatCount: z.number().int().min(1).max(MAX_REPEAT_COUNT).optional(),
    simulatorModel: z.string().nullish(),
    judgeModel: z.string().nullish(),
    traceQuietPeriodMs: traceQuietPeriodMsSchema.nullish(),
    traceWaitTimeoutMs: traceWaitTimeoutMsSchema.nullish(),
    /** The scenarios a hand-picked scope covers; ignored by every other. */
    scenarioIds: z.array(z.string()).optional(),
    /** The plan's own evaluators, beside the suites'. Absent keeps what the plan holds. */
    evaluators: evaluatorAttachmentsSchema.optional(),
  })
  .strict();
export interface RunPlanConfigSchema extends Named<typeof runPlanConfigSchemaDefinition> {}
export const runPlanConfigSchema: RunPlanConfigSchema = runPlanConfigSchemaDefinition;
export type RunPlanConfigInput = z.infer<typeof runPlanConfigSchema>;

/**
 * Starts a run under a NAME: the run either joins the plan of that name and replaces its
 * config, or creates one.
 * @see specs/suites/run-plan-identity-by-name.feature
 */
const suiteRunPlanInputSchemaDefinition = suiteRunInputSchema
  .omit({ id: true })
  .safeExtend({
    name: z.string().trim().min(1).max(MAX_PLAN_NAME_LENGTH).optional(),
    config: runPlanConfigSchema,
  })
  .strict();
export interface SuiteRunPlanInputSchema extends Named<typeof suiteRunPlanInputSchemaDefinition> {}
export const suiteRunPlanInputSchema: SuiteRunPlanInputSchema = suiteRunPlanInputSchemaDefinition;
export type SuiteRunPlanInput = z.infer<typeof suiteRunPlanInputSchema>;

export type SuiteRunPlanResult = SuiteRunResult & {
  suiteId: string;
  planName: string;
  /** The address segment of the plan the run joined or created, as main returns it. */
  planSlug: string;
  created: boolean;
};

const suiteArchivedNamesInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    organizationId: z.string().min(1),
    scenarioIds: z.array(z.string().min(1)),
    targets: z.array(suiteTargetSchema),
  })
  .strict();
export interface SuiteArchivedNamesInputSchema extends Named<
  typeof suiteArchivedNamesInputSchemaDefinition
> {}
export const suiteArchivedNamesInputSchema: SuiteArchivedNamesInputSchema =
  suiteArchivedNamesInputSchemaDefinition;
export type SuiteArchivedNamesInput = z.infer<typeof suiteArchivedNamesInputSchema>;

export type SuiteRunResult = {
  batchRunId: string;
  setId: string;
  jobCount: number;
  skippedArchived: {
    scenarios: string[];
    targets: string[];
  };
  items: {
    scenarioRunId: string;
    scenarioId: string;
    target: SuiteTarget;
    name: string | undefined;
  }[];
};

export type SuiteRunAllResult = SuiteRunResult & { suiteId: string; planSlug: string };

/** The durable fold state exposed by the Suite run read model. */
const suiteRunStateDataSchemaDefinition = z
  .object({
    SuiteRunId: z.string(),
    BatchRunId: z.string(),
    ScenarioSetId: z.string(),
    SuiteId: z.string(),
    Status: z.string(),
    Total: z.number(),
    StartedCount: z.number(),
    CompletedCount: z.number(),
    FailedCount: z.number(),
    Progress: z.number(),
    PassRateBps: z.number().nullable(),
    CreatedAt: z.number(),
    UpdatedAt: z.number(),
    LastEventOccurredAt: z.number(),
    StartedAt: z.number().nullable(),
    FinishedAt: z.number().nullable(),
    PassedCount: z.number(),
    GradedCount: z.number(),
  })
  .strict();
export interface SuiteRunStateDataSchema extends Named<typeof suiteRunStateDataSchemaDefinition> {}
export const suiteRunStateDataSchema: SuiteRunStateDataSchema = suiteRunStateDataSchemaDefinition;
export type SuiteRunStateData = z.infer<typeof suiteRunStateDataSchema>;

const INTERNAL_SET_PREFIX = "__internal__";
export const SUITE_SET_SUFFIX = "__suite";

export function isSuiteSetId(setId: string): boolean {
  return setId.startsWith(INTERNAL_SET_PREFIX) && setId.endsWith(SUITE_SET_SUFFIX);
}

export function getSuiteSetId(suiteId: string): string {
  return `${INTERNAL_SET_PREFIX}${suiteId}${SUITE_SET_SUFFIX}`;
}

export function extractSuiteId(setId: string): string | null {
  if (!isSuiteSetId(setId)) return null;
  return setId.slice(INTERNAL_SET_PREFIX.length, -SUITE_SET_SUFFIX.length);
}

/** "archetype" ships everyday behaviour tests; "red_team_pack" ships attacks. */
export const SUITE_TEMPLATE_KINDS = ["archetype", "red_team_pack"] as const;
export const suiteTemplateKindSchema = z.enum(SUITE_TEMPLATE_KINDS);
export type SuiteTemplateKind = z.infer<typeof suiteTemplateKindSchema>;

export const suiteTemplateIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);

const suiteTemplateAttackSchemaDefinition = z
  .object({
    attackGoal: z.string().min(1),
    owaspIds: z.array(owaspIdSchema).min(1),
    strategy: redTeamStrategySchema,
    maxTurns: z
      .number()
      .int()
      .min(1)
      .max(RED_TEAM_MAX_TURNS_CAP)
      .default(RED_TEAM_DEFAULT_MAX_TURNS),
  })
  .strict();

/**
 * One scenario a template creates. Text may hold `{{agentName}}`, `{{tools}}` and
 * `{{mustNever}}`, which applying the template fills from the fit config.
 */
const suiteTemplateScenarioSchemaDefinition = z
  .object({
    key: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string().min(1),
    situation: z.string().min(1),
    criteria: z.array(z.string().min(1)).min(1),
    labels: z.array(z.string()).default([]),
    attack: suiteTemplateAttackSchemaDefinition.optional(),
  })
  .strict();
export interface SuiteTemplateScenarioSchema extends Named<
  typeof suiteTemplateScenarioSchemaDefinition
> {}
export const suiteTemplateScenarioSchema: SuiteTemplateScenarioSchema =
  suiteTemplateScenarioSchemaDefinition;
export type SuiteTemplateScenario = z.infer<typeof suiteTemplateScenarioSchema>;

const suiteTemplateSchemaDefinition = z
  .object({
    id: suiteTemplateIdSchema,
    version: z.number().int().positive(),
    kind: suiteTemplateKindSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    /** Criteria every scenario of the template carries, after its own. */
    criteria: z.array(z.string().min(1)).default([]),
    scenarios: z.array(suiteTemplateScenarioSchema).min(1).max(50),
  })
  .strict()
  .superRefine((template, context) => {
    template.scenarios.forEach((scenario, index) => {
      const isAttack = scenario.attack !== undefined;
      if (isAttack !== (template.kind === "red_team_pack")) {
        context.addIssue({
          code: "custom",
          path: ["scenarios", index, "attack"],
          message:
            "A red team pack scenario carries an attack; an archetype scenario carries none.",
        });
      }
    });
  });
export interface SuiteTemplateSchema extends Named<typeof suiteTemplateSchemaDefinition> {}
export const suiteTemplateSchema: SuiteTemplateSchema = suiteTemplateSchemaDefinition;
export type SuiteTemplate = z.infer<typeof suiteTemplateSchema>;

/** What the person tells the template about their agent before it is applied. */
const suiteTemplateFitSchemaDefinition = z
  .object({
    agentName: z.string().trim().min(1).max(120),
    tools: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    mustNever: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  })
  .strict();
export interface SuiteTemplateFitSchema extends Named<typeof suiteTemplateFitSchemaDefinition> {}
export const suiteTemplateFitSchema: SuiteTemplateFitSchema = suiteTemplateFitSchemaDefinition;
export type SuiteTemplateFit = z.infer<typeof suiteTemplateFitSchema>;

const applySuiteTemplateInputSchemaDefinition = z
  .object({
    templateId: suiteTemplateIdSchema,
    fit: suiteTemplateFitSchema,
    /** The new suite's name; defaults to the template title. */
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export interface ApplySuiteTemplateInputSchema extends Named<
  typeof applySuiteTemplateInputSchemaDefinition
> {}
export const applySuiteTemplateInputSchema: ApplySuiteTemplateInputSchema =
  applySuiteTemplateInputSchemaDefinition;
export type ApplySuiteTemplateInput = z.infer<typeof applySuiteTemplateInputSchema>;

const applySuiteTemplateTrpcInputSchemaDefinition = z
  .object({ ...applySuiteTemplateInputSchemaDefinition.shape, projectId: z.string().min(1) })
  .strict();
export interface ApplySuiteTemplateTrpcInputSchema extends Named<
  typeof applySuiteTemplateTrpcInputSchemaDefinition
> {}
export const applySuiteTemplateTrpcInputSchema: ApplySuiteTemplateTrpcInputSchema =
  applySuiteTemplateTrpcInputSchemaDefinition;
export type ApplySuiteTemplateTrpcInput = z.infer<typeof applySuiteTemplateTrpcInputSchema>;

/** What applying a template created: the new test suite and the scenarios filed in it. */
const appliedSuiteTemplateSchemaDefinition = z
  .object({
    suiteId: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    scenarioIds: z.array(z.string().min(1)),
  })
  .strict();
export interface AppliedSuiteTemplateSchema extends Named<
  typeof appliedSuiteTemplateSchemaDefinition
> {}
export const appliedSuiteTemplateSchema: AppliedSuiteTemplateSchema =
  appliedSuiteTemplateSchemaDefinition;
export type AppliedSuiteTemplate = z.infer<typeof appliedSuiteTemplateSchema>;

/** `POST /api/v1/test-suites/templates/{templateId}/apply` path params. */
const suiteTemplateIdParamsSchemaDefinition = z
  .object({ templateId: suiteTemplateIdSchema })
  .strict();
export interface SuiteTemplateIdParamsSchema extends Named<
  typeof suiteTemplateIdParamsSchemaDefinition
> {}
export const suiteTemplateIdParamsSchema: SuiteTemplateIdParamsSchema =
  suiteTemplateIdParamsSchemaDefinition;

const applySuiteTemplateBodySchemaDefinition = applySuiteTemplateInputSchemaDefinition.omit({
  templateId: true,
});
export interface ApplySuiteTemplateBodySchema extends Named<
  typeof applySuiteTemplateBodySchemaDefinition
> {}
/** The apply request body: the fit and an optional suite name; the template comes from the path. */
export const applySuiteTemplateBodySchema: ApplySuiteTemplateBodySchema =
  applySuiteTemplateBodySchemaDefinition;

/** The 404 a test-suites route sends: the flat error plus its cause, e.g. `suite_not_found`. */
const testSuiteNotFoundWireSchemaDefinition = z.object({
  error: z.string(),
  message: z.string().optional(),
  code: z.string(),
});
export interface TestSuiteNotFoundWireSchema extends Named<
  typeof testSuiteNotFoundWireSchemaDefinition
> {}
export const testSuiteNotFoundWireSchema: TestSuiteNotFoundWireSchema =
  testSuiteNotFoundWireSchemaDefinition;
