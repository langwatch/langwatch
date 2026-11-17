import type { Named } from "@langwatch/module";
import {
  owaspIdSchema,
  RED_TEAM_DEFAULT_MAX_TURNS,
  RED_TEAM_MAX_TURNS_CAP,
  redTeamStrategySchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

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
export const suiteTemplateIdParamsSchema = z.object({ templateId: suiteTemplateIdSchema }).strict();

const applySuiteTemplateBodySchemaDefinition = applySuiteTemplateInputSchemaDefinition.omit({
  templateId: true,
});
export interface ApplySuiteTemplateBodySchema extends Named<
  typeof applySuiteTemplateBodySchemaDefinition
> {}
/** The apply request body: the fit and an optional suite name; the template comes from the path. */
export const applySuiteTemplateBodySchema: ApplySuiteTemplateBodySchema =
  applySuiteTemplateBodySchemaDefinition;
