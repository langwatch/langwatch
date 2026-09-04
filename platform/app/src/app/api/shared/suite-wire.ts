/**
 * The wire shapes the agent-testing REST families publish.
 *
 * Two families and one deprecated alias describe the same two things, so the
 * schemas live here once:
 *
 *   - a RUN PLAN is what you run. It is identified by its NAME: a run started
 *     under a name joins the plan of that name and replaces its configuration,
 *     or creates the plan when nothing answers.
 *   - a TEST SUITE is a group of scenarios. It holds what it collects and
 *     nothing about how a run of it is executed, so the targets, the repeat
 *     count and the models arrive with the run request.
 *
 * Every field is described, because these descriptions are what an integrator
 * reads in the API reference.
 */

import { z } from "zod";
import type { SimulationSuite } from "~/generated/prisma/client";
import { modelOverrideSchema } from "~/server/modelProviders/modelOverrideSchema";
import { runParameterValuesSchema } from "~/server/scenarios/parameters";
import { runNoteSchema } from "~/server/scenarios/run-note";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import { MAX_PLAN_NAME_LENGTH } from "~/server/suites/plan-name";
import { parseSuiteScope, suiteScopeSchema } from "~/server/suites/scope";

/**
 * A target on the wire.
 *
 * What addresses a target, plus the parameter values that target alone runs
 * with. The prompt-input bindings the domain target also carries are written
 * by the platform's own run dialog, never sent by an API caller.
 */
export const suiteTargetSchema = z.object({
  type: z
    .enum(["prompt", "http", "code", "workflow", "connected"])
    .describe(
      "What kind of thing the scenarios run against. A connected agent is one registered from code with the SDK.",
    ),
  referenceId: z
    .string()
    .describe(
      "The id of the prompt, agent or workflow to run against. A connected target may also say <name>@<environment>, for example support-agent@production, which resolves to the agent id.",
    ),
  runParameters: runParameterValuesSchema
    .optional()
    .describe(
      "Parameter values this target alone runs with, by name. They are merged over the run-level parameters and the target wins, so two targets may name the same agent with different values: that is how one run compares one agent on two models, and the results show one column for each target.",
    ),
});

/** What a query string may say for yes and for no. Compared case-folded. */
const QUERY_BOOLEAN_TRUE = ["true", "1", "yes"];
const QUERY_BOOLEAN_FALSE = ["false", "0", "no", ""];

/**
 * A boolean spelled in a query string.
 *
 * `z.coerce.boolean()` is JavaScript `Boolean()`, so every non-empty string is
 * true and `includeArchived=false` would turn the filter off. The most obvious
 * way to spell "off" must not mean "on", and a spelling this does not know is
 * refused by name rather than guessed at.
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

/** What a run plan covers. */
export const runPlanScopeSchema = suiteScopeSchema.describe(
  "What the run plan covers: all (every active scenario), test_suites (the scenarios filed in the named test suites), labels (the scenarios carrying any of the labels), or scenarios (the scenarioIds sent with the configuration). A dynamic scope is resolved again at every run, so a scenario written later runs without editing the plan.",
);

/** The configuration a run plan holds, as a caller sends it. */
export const runPlanConfigSchema = z.object({
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
});

/** The values supplied for one run, shared by every run request. */
const runValuesShape = {
  idempotencyKey: z
    .string()
    .optional()
    .describe(
      "Repeat the same key to make a retry join the batch the first call started instead of running everything again. Defaults to a new key per call.",
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
  config: runPlanConfigSchema.describe(
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

/** One run plan, as the API publishes it. */
export const runPlanSchema = z.object({
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
  scenarioIds: z
    .array(z.string())
    .describe("The scenarios the last run of this plan covered."),
  targets: z
    .array(suiteTargetSchema)
    .describe(
      "What the plan runs against, in the order the results show. A target carrying runParameters runs with those values.",
    ),
  repeatCount: z
    .number()
    .describe("How many times each scenario and target pairing runs."),
  simulatorModel: z
    .string()
    .nullable()
    .describe(
      "The model that plays the user, or null for the scenario or project default.",
    ),
  judgeModel: z
    .string()
    .nullable()
    .describe(
      "The model that judges the run, or null for the scenario or project default.",
    ),
  labels: z.array(z.string()).describe("The labels the plan carries."),
  archivedAt: z
    .string()
    .nullable()
    .describe("When the plan was archived, or null while it is active."),
  createdAt: z.string().describe("When the plan was created."),
  updatedAt: z.string().describe("When the plan was last written."),
  platformUrl: z
    .string()
    .url()
    .describe("Where to open this run plan in the LangWatch platform."),
});

/** What a run answers with, whichever way the run was started. */
export const runPlanRunResultSchema = z.object({
  scheduled: z.boolean().describe("True once the runs are queued."),
  batchRunId: z
    .string()
    .describe("The id of this batch. Every run started here carries it."),
  setId: z
    .string()
    .describe("The result set the batch is filed under in the platform."),
  jobCount: z.number().describe("How many runs were queued."),
  skippedArchived: z
    .object({
      scenarios: z
        .array(z.string())
        .describe("Scenarios left out because they are archived."),
      targets: z
        .array(z.string())
        .describe("Targets left out because they are archived."),
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
    .describe(
      "True when this run created the plan, false when it joined a plan already there.",
    ),
  platformUrl: z
    .string()
    .url()
    .describe("Where to watch this run in the LangWatch platform."),
});

/** One test suite, as the API publishes it. */
export const testSuiteSchema = z.object({
  id: z.string().describe("The test suite id."),
  name: z.string().describe("The test suite name."),
  slug: z
    .string()
    .describe(
      "The suite's address in the platform. It is kept when the suite is renamed.",
    ),
  scenarioIds: z
    .array(z.string())
    .describe("The scenarios filed in this suite, in the order it shows them."),
  scenarioCount: z.number().describe("How many scenarios are filed in it."),
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

/** One test suite with the scenarios filed in it, named. */
export const testSuiteDetailSchema = testSuiteSchema.extend({
  scenarios: z
    .array(
      z.object({
        id: z.string().describe("The scenario id."),
        name: z.string().describe("The scenario name."),
      }),
    )
    .describe(
      "The active scenarios filed in this suite. An archived scenario is left out.",
    ),
});

export type SuiteTargetWire = z.infer<typeof suiteTargetSchema>;
export type RunPlanRunResultWire = z.infer<typeof runPlanRunResultSchema>;
export type RunPlanWire = z.infer<typeof runPlanSchema>;
export type TestSuiteWire = z.infer<typeof testSuiteSchema>;
export type TestSuiteDetailWire = z.infer<typeof testSuiteDetailSchema>;

/**
 * The runs a call queued, as the wire shape.
 *
 * A scenario the project no longer names carries no name at all in the domain
 * result. On the wire that is `null`: JSON has no undefined, and an absent key
 * would make the field optional for every consumer rather than nullable for
 * the few rows that need it.
 */
export function toRunItemsWire(
  items: readonly {
    scenarioRunId: string;
    scenarioId: string;
    target: { type: SuiteTargetWire["type"]; referenceId: string };
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

/**
 * The stored targets column, as the wire shape.
 *
 * The column is JSON, and rows written before the current shape may hold a
 * string, so it is read defensively rather than parsed strictly: a plan whose
 * targets cannot be read still lists, it just lists with none. Each entry is
 * parsed on its own, so one bad entry costs its own row and not the rest.
 * Casting instead would publish `type` and `referenceId` as undefined.
 */
function readTargets(raw: unknown): SuiteTargetWire[] {
  const value = typeof raw === "string" ? parseJson(raw) : raw;
  if (!Array.isArray(value)) return [];
  const targets: SuiteTargetWire[] = [];
  for (const entry of value) {
    const parsed = suiteTargetSchema.safeParse(entry);
    if (parsed.success) targets.push(parsed.data);
  }
  return targets;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** One run plan row, as the API publishes it. */
export function toRunPlanWire({
  suite,
  platformUrl,
}: {
  suite: SimulationSuite;
  platformUrl: string;
}): RunPlanWire {
  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    scope: parseSuiteScope(suite.scope),
    scenarioIds: suite.scenarioIds,
    targets: readTargets(suite.targets),
    repeatCount: suite.repeatCount,
    simulatorModel: suite.simulatorModel,
    judgeModel: suite.judgeModel,
    labels: suite.labels,
    archivedAt: suite.archivedAt?.toISOString() ?? null,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
    platformUrl,
  };
}

/** One test suite row, as the API publishes it. */
export function toTestSuiteWire({
  suite,
  platformUrl,
}: {
  suite: SimulationSuite;
  platformUrl: string;
}): TestSuiteWire {
  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    scenarioIds: suite.scenarioIds,
    scenarioCount: suite.scenarioIds.length,
    archivedAt: suite.archivedAt?.toISOString() ?? null,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
    platformUrl,
  };
}
