/**
 * The wire shapes the `/api/v1/run-plans` and `/api/v1/test-suites` REST families publish.
 * Speaks the domain's own scope vocabulary (all/test_suites/labels/scenarios) — unlike the
 * deprecated `/api/suites` alias, which remaps to folders/cases.
 */
import { defineRestMiddleware } from "@langwatch/api/rest";
import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import {
  type EvaluatorAttachment,
  MAX_SUITE_FIELDS,
  runNoteSchema,
  runParameterValuesSchema,
  suiteFieldDefinitionSchema,
} from "@langwatch/scenario-contract";
import {
  evaluatorAttachmentsWireSchema,
  MAX_PLAN_NAME_LENGTH,
  MAX_REPEAT_COUNT,
  parseSuiteScope,
  runPlanScopeSchema,
  suiteTargetSchema,
  type RunPlanWire,
  type Suite,
  type SuiteTarget,
} from "@langwatch/suite-contract";
import { z } from "zod";

/**
 * Where a run was started from, bound once by the process: the surface as `X-LangWatch-Surface`
 * spells it, and the API key the run started with so the run's own key holds no more. The key is
 * null for a legacy API key or a project-bound access token, which have no key row.
 */
export const suiteRunOriginFact = defineRestMiddleware(
  "suiteRunOrigin",
  z.object({
    surface: z.string().nullable(),
    callerKey: z.string().min(1).nullable(),
  }),
);

export const suiteFieldWireSchema = suiteFieldDefinitionSchema.describe(
  "One field the test suite declares beyond situation and criteria. Every scenario filed in the suite carries a value for it.",
);

export const suiteFieldsWireSchema = z
  .array(suiteFieldWireSchema)
  .max(MAX_SUITE_FIELDS)
  .describe(
    `The fields the test suite declares, in the order the platform shows them. Up to ${MAX_SUITE_FIELDS}. An identifier is lowercase letters, digits and underscores, starting with a letter; the type is text, number or boolean.`,
  );

/** The configuration a run plan holds, as a caller sends it. */
export const runPlanConfigWireSchema = z.object({
  scope: runPlanScopeSchema,
  targets: z
    .array(suiteTargetSchema)
    .describe(
      "The prompts, agents or workflows every scenario runs against. Every target runs every scenario, so naming more than one compares them in the same run.",
    ),
  repeatCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_REPEAT_COUNT)
    .optional()
    .describe(
      `How many times each scenario and target pairing runs. Between 1 and ${MAX_REPEAT_COUNT}; defaults to 1.`,
    ),
  simulatorModel: modelOverrideSchema
    .nullish()
    .describe(
      "The model that plays the user for every scenario in the run. Overrides each scenario's own choice. Leave it out for the scenario or project default.",
    ),
  judgeModel: modelOverrideSchema
    .nullish()
    .describe(
      "The model that judges every scenario in the run. Overrides each scenario's own choice. Leave it out for the scenario or project default.",
    ),
  scenarioIds: z
    .array(z.string())
    .optional()
    .describe(
      "The scenarios a test_suites or scenarios scope covers. Read by a scenarios scope alone; a scope that states a rule resolves its own list at run time.",
    ),
  evaluators: evaluatorAttachmentsWireSchema
    .optional()
    .describe(
      "The plan's own evaluators, run beside the ones attached to the test suites its scenarios belong to. A plan evaluator reads the conversation and the trace, never a scenario field. Leave it out to keep what the plan already holds.",
    ),
});

/** The values supplied for one run, shared by every run request. */
const runValuesShape = {
  idempotencyKey: z
    .string()
    .optional()
    .describe(
      "Repeat the same key to make a retry join the batch the first call started instead of running everything again. Send the same request with it: the same key over a different configuration starts its own batch. Defaults to a new key per call.",
    ),
  parameters: runParameterValuesSchema
    .optional()
    .describe(
      "Constant values applied to every scenario in the run, e.g. a fixture id or a tenant. A value supplied here overrides the scenario's own default for that name, and a target that names the same parameter in its runParameters overrides it for that target.",
    ),
  note: runNoteSchema.describe(
    "One short line describing why this batch was run, e.g. a commit hash or what you changed. It is stored on every run of the batch and shown beside the run in the platform. Up to 200 characters.",
  ),
};

/** Starting a run of a configuration, under a name. */
export const runPlanRunInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .optional()
    .describe(
      `The run plan this run joins or creates. A run plan is identified by its name, so sending the same name again replaces that plan's configuration with this one. Leave it out and the name is derived from what the run covers and what it runs against. Up to ${MAX_PLAN_NAME_LENGTH} characters.`,
    ),
  config: runPlanConfigWireSchema.describe(
    "What this run covers and what it runs against. Written onto the run plan the name resolves.",
  ),
  ...runValuesShape,
});

/** Starting a run of a stored run plan, or of a test suite, by its id. */
export const rerunInputSchema = z.object(runValuesShape);

/** Starting a run of one test suite against the targets sent with it. */
export const testSuiteRunInputSchema = z.object({
  // No minimum: an empty list is a run with no target, which the domain
  // refuses as suite_targets_required rather than as a malformed body.
  targets: z
    .array(suiteTargetSchema)
    .describe(
      "The prompts, agents or workflows the suite runs against. A test suite stores none of its own, so a run states them. Every target runs every scenario, so naming more than one compares them in the same run.",
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .optional()
    .describe(
      "The run plan this run joins or creates. Leave it out and the name is derived from the suite name and the targets.",
    ),
  repeatCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_REPEAT_COUNT)
    .optional()
    .describe(
      `How many times each scenario and target pairing runs. Between 1 and ${MAX_REPEAT_COUNT}; defaults to 1.`,
    ),
  simulatorModel: modelOverrideSchema
    .nullish()
    .describe(
      "The model that plays the user for every scenario in this run. Leave it out for the scenario or project default.",
    ),
  judgeModel: modelOverrideSchema
    .nullish()
    .describe(
      "The model that judges every scenario in this run. Leave it out for the scenario or project default.",
    ),
  ...runValuesShape,
});

/** What a run answers with, whichever way the run was started. */
export const runPlanRunResultSchema = z.object({
  scheduled: z.boolean().describe("True once the runs are queued."),
  batchRunId: z.string().describe("The id of this batch. Every run started here carries it."),
  setId: z.string().describe("The result set the batch is filed under in the platform."),
  jobCount: z.number().describe("How many runs were queued."),
  skippedArchived: z
    .object({
      scenarios: z.array(z.string()).describe("Scenarios left out because they are archived."),
      targets: z.array(z.string()).describe("Targets left out because they are archived."),
    })
    .describe("What the run left out, and why."),
  items: z
    .array(
      z.object({
        scenarioRunId: z.string().describe("The id of this single run."),
        scenarioId: z.string().describe("The scenario that was run."),
        target: suiteTargetSchema.describe("What it was run against."),
        name: z.string().nullable().describe("The scenario name, when known."),
      }),
    )
    .describe("Every run this call queued."),
  runPlanId: z.string().describe("The run plan this run was filed under."),
  planName: z.string().describe("The name that plan answers to."),
  created: z
    .boolean()
    .describe("True when this run created the plan, false when it joined a plan already there."),
  platformUrl: z.string().url().describe("Where to watch this run in the LangWatch platform."),
});

/** One test suite, as the API publishes it. */
export const testSuiteWireSchema = z.object({
  id: z.string().describe("The test suite id."),
  name: z.string().describe("The test suite name."),
  slug: z
    .string()
    .describe("The suite's address in the platform. It is kept when the suite is renamed."),
  scenarioIds: z
    .array(z.string())
    .describe("The scenarios filed in this suite, in the order it shows them."),
  scenarioCount: z.number().describe("How many scenarios are filed in it."),
  fields: suiteFieldsWireSchema
    .optional()
    .describe(
      "The fields the test suite declares. Absent on servers that predate fields on this family.",
    ),
  evaluators: evaluatorAttachmentsWireSchema
    .optional()
    .describe(
      "The evaluators attached to the test suite. Absent on servers that predate evaluators on this family.",
    ),
  archivedAt: z
    .string()
    .nullable()
    .describe("When the suite was archived, or null while it is active."),
  createdAt: z.string().describe("When the suite was created."),
  updatedAt: z.string().describe("When the suite was last written."),
  platformUrl: z
    .string()
    .url()
    .describe("Where to open this test suite in the LangWatch platform."),
});

export type TestSuiteWire = z.infer<typeof testSuiteWireSchema>;

/** One test suite with the scenarios filed in it, named. */
export const testSuiteDetailWireSchema = z.object({
  ...testSuiteWireSchema.shape,
  scenarios: z
    .array(
      z.object({
        id: z.string().describe("The scenario id."),
        name: z.string().describe("The scenario name."),
      }),
    )
    .describe("The active scenarios filed in this suite. An archived scenario is left out."),
});

export const testSuiteCreateInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .describe("The test suite name, as it reads in the platform."),
  fields: suiteFieldsWireSchema.optional(),
  evaluators: evaluatorAttachmentsWireSchema.optional(),
});

export const testSuiteUpdateInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .optional()
    .describe("The new name. The slug is kept."),
  fields: suiteFieldsWireSchema
    .optional()
    .describe(
      "The full list of fields the suite declares. A field an attached evaluator still reads cannot be removed: answers 422 suite_field_in_use.",
    ),
  evaluators: evaluatorAttachmentsWireSchema
    .optional()
    .describe(
      "The full list of evaluators attached to the suite. An evaluator the project does not hold answers 422 suite_evaluator_not_found; a mapping the run cannot read answers 422 suite_evaluator_mapping_invalid.",
    ),
});

export type SuiteTargetWire = z.infer<typeof suiteTargetSchema>;
export type RunPlanRunResultWire = z.infer<typeof runPlanRunResultSchema>;

/**
 * The runs a call queued, as the wire shape.
 */
export function toRunItemsWire(
  items: readonly {
    scenarioRunId: string;
    scenarioId: string;
    target: { type: SuiteTarget["type"]; referenceId: string };
    name: string | undefined;
  }[],
): RunPlanRunResultWire["items"] {
  return items.map((item) => ({
    scenarioRunId: item.scenarioRunId,
    scenarioId: item.scenarioId,
    target: { type: item.target.type, referenceId: item.target.referenceId },
    name: item.name ?? null,
  }));
}

/** One run plan as the API publishes it (main's `toRunPlanWire`). */
export function toRunPlanWire({
  suite,
  evaluators,
  platformUrl,
}: {
  suite: Suite;
  evaluators: EvaluatorAttachment[];
  platformUrl: string;
}): RunPlanWire {
  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    // A row stored before scopes carries null and runs its stored
    // `scenarioIds`; the wire always answers the concrete scope that means.
    scope: parseSuiteScope(suite.scope),
    scenarioIds: suite.scenarioIds,
    targets: suite.targets,
    repeatCount: suite.repeatCount,
    simulatorModel: suite.simulatorModel,
    judgeModel: suite.judgeModel,
    labels: suite.labels,
    evaluators,
    archivedAt: suite.archivedAt?.toISOString() ?? null,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
    platformUrl,
  };
}
