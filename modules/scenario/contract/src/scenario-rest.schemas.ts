import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  scenarioParameterDefinitionSchema,
  scenarioParameterDefinitionsSchema,
} from "./scenario.parameters.ts";
import { scenarioFieldValuesSchema } from "./suite-fields.ts";

/** The shared bare `{ error }` body the pre-conversion scenario families answer a miss with. */
const scenarioLegacyErrorBodySchemaDefinition = z.object({ error: z.string() });
export interface ScenarioLegacyErrorBodySchema extends Named<
  typeof scenarioLegacyErrorBodySchemaDefinition
> {}
export const scenarioLegacyErrorBodySchema: ScenarioLegacyErrorBodySchema =
  scenarioLegacyErrorBodySchemaDefinition;

const scenarioRestResponseSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
  parameters: z.array(scenarioParameterDefinitionSchema),
  /**
   * The five fields below are optional in the document, not the answer —
   * every server sends them. They arrived after clients were generated, and
   * a client reading one as required fails against an older server.
   * @see specs/api-reference/legacy-response-fields-optional.feature
   */
  simulatorModel: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The model that plays the user, or null for the project default. Absent on servers that predate model overrides on this family.",
    ),
  judgeModel: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The model that judges the run, or null for the project default. Absent on servers that predate model overrides on this family.",
    ),
  maxTurns: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      "The most conversation turns a run of this scenario takes, or null for the default. Absent on servers that predate turn limits on this family.",
    ),
  minTurns: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      "The fewest conversation turns before the judge may end a run, or null for the default. Absent on servers that predate turn limits on this family.",
    ),
  testSuiteId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The test suite this scenario is filed in, or null when unfiled. Absent on servers that predate test suites.",
    ),
  fields: scenarioFieldValuesSchema
    .optional()
    .describe(
      "The value this scenario carries for each field its test suite declares, keyed by field identifier. A field with no value has no key. Absent on servers that predate suite fields.",
    ),
});
export interface ScenarioRestResponseSchema extends Named<
  typeof scenarioRestResponseSchemaDefinition
> {}
export const scenarioRestResponseSchema: ScenarioRestResponseSchema =
  scenarioRestResponseSchemaDefinition;

const scenarioRestResponseWithPlatformUrlSchemaDefinition = z.object({
  ...scenarioRestResponseSchema.shape,
  platformUrl: z.string().url(),
});
export interface ScenarioRestResponseWithPlatformUrlSchema extends Named<
  typeof scenarioRestResponseWithPlatformUrlSchemaDefinition
> {}
export const scenarioRestResponseWithPlatformUrlSchema: ScenarioRestResponseWithPlatformUrlSchema =
  scenarioRestResponseWithPlatformUrlSchemaDefinition;

const scenarioRestVersionSummarySchemaDefinition = z.object({
  version: z.number().int().describe("The version number, counting from 1."),
  authorLabel: z
    .string()
    .nullable()
    .describe(
      "Which surface wrote the version: user, api, cli or langy. Null on the synthesized Created entry of a scenario saved before versions were recorded.",
    ),
  authorId: z
    .string()
    .nullable()
    .describe("The user who saved the version. Null when the save came from an API key."),
  changeDescription: z.string().nullable(),
  changedFields: z.array(z.string()).describe("The fields whose value this save changed."),
  createdAt: z.string().describe("When the version was written, in ISO 8601."),
  isSynthesized: z
    .boolean()
    .describe(
      "True on the Created entry a scenario saved before versions were recorded shows. It has no stored snapshot, so it cannot be read back.",
    ),
});
export interface ScenarioRestVersionSummarySchema extends Named<
  typeof scenarioRestVersionSummarySchemaDefinition
> {}
export const scenarioRestVersionSummarySchema: ScenarioRestVersionSummarySchema =
  scenarioRestVersionSummarySchemaDefinition;

const scenarioRestVersionListResponseSchemaDefinition = z.object({
  versions: z.array(scenarioRestVersionSummarySchema),
  nextCursor: z
    .number()
    .int()
    .nullable()
    .describe("Pass as cursor to read the page below this one. Null on the last page."),
});
export interface ScenarioRestVersionListResponseSchema extends Named<
  typeof scenarioRestVersionListResponseSchemaDefinition
> {}
export const scenarioRestVersionListResponseSchema: ScenarioRestVersionListResponseSchema =
  scenarioRestVersionListResponseSchemaDefinition;

const scenarioRestVersionDetailResponseSchemaDefinition = z.object({
  ...scenarioRestVersionSummarySchema.shape,
  schemaVersion: z.number().int().describe("The shape the snapshot was written in."),
  snapshot: z
    .object({
      name: z.string(),
      situation: z.string(),
      criteria: z.array(z.string()),
      labels: z.array(z.string()),
      parameters: z.array(scenarioParameterDefinitionSchema),
      simulatorModel: z.string().nullable(),
      judgeModel: z.string().nullable(),
      maxTurns: z.number().nullable(),
      minTurns: z.number().nullable(),
      fields: scenarioFieldValuesSchema
        .optional()
        .describe(
          "The field values as this version saved them. Absent on servers that predate suite fields.",
        ),
    })
    .describe("The editable content of the case as this version saved it."),
});
export interface ScenarioRestVersionDetailResponseSchema extends Named<
  typeof scenarioRestVersionDetailResponseSchemaDefinition
> {}
export const scenarioRestVersionDetailResponseSchema: ScenarioRestVersionDetailResponseSchema =
  scenarioRestVersionDetailResponseSchemaDefinition;

const scenarioRestListVersionsQuerySchemaDefinition = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read the page below this version number."),
});
export interface ScenarioRestListVersionsQuerySchema extends Named<
  typeof scenarioRestListVersionsQuerySchemaDefinition
> {}
export const scenarioRestListVersionsQuerySchema: ScenarioRestListVersionsQuerySchema =
  scenarioRestListVersionsQuerySchemaDefinition;

const parametersDescription =
  "The parameters this scenario declares by name, each with an optional description and default. A run supplies values for these names, readable from the scenario's own text as params.NAME. A parameter marked secret carries no default: its value is supplied per run, encrypted, delivered to the target as secrets.NAME, and never readable from the scenario's own text.";

const testSuiteIdDescription =
  "The test suite to file this scenario in. It must name a non-archived test suite of the same project. null files the scenario into the project's Default test suite.";

const simulatorModelDescription =
  "Model for the simulated user, e.g. openai/gpt-5-mini. Null uses the project default.";
const judgeModelDescription =
  "Model for the judge, e.g. openai/gpt-5-mini. Null uses the project default.";
const maxTurnsDescription =
  "Maximum conversation turns for a run of this scenario. Null uses the default.";
const minTurnsDescription =
  "Minimum conversation turns before the judge may end the run. Null uses the default.";

const scenarioRestCreateSchemaDefinition = z.object({
  name: z.string().min(1, "name is required"),
  situation: z.string(),
  criteria: z.array(z.string()).optional().default([]),
  labels: z.array(z.string()).optional().default([]),
  parameters: scenarioParameterDefinitionsSchema.optional().describe(parametersDescription),
  simulatorModel: modelOverrideSchema.nullish().describe(simulatorModelDescription),
  judgeModel: modelOverrideSchema.nullish().describe(judgeModelDescription),
  maxTurns: z.number().int().min(1).max(100).nullish().describe(maxTurnsDescription),
  minTurns: z.number().int().min(0).max(100).nullish().describe(minTurnsDescription),
  testSuiteId: z.string().nullish().describe(testSuiteIdDescription),
  fields: scenarioFieldValuesSchema
    .optional()
    .describe(
      "The value for each field the test suite declares, keyed by field identifier: text, a number or a boolean, in the field's own type. A field the suite does not declare answers 422 scenario_field_unknown; a value of the wrong type answers 422 scenario_field_type_invalid. An empty value clears the field.",
    ),
});
export interface ScenarioRestCreateSchema extends Named<
  typeof scenarioRestCreateSchemaDefinition
> {}
export const scenarioRestCreateSchema: ScenarioRestCreateSchema =
  scenarioRestCreateSchemaDefinition;

/**
 * Strict, so a field this endpoint does not have (`status`) is refused by name
 * instead of dropped behind a 200: the caller must learn the write did not do
 * what it asked.
 */
const scenarioRestUpdateSchemaDefinition = z
  .object({
    name: z.string().min(1).optional(),
    situation: z.string().optional(),
    criteria: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
    parameters: scenarioParameterDefinitionsSchema.optional().describe(parametersDescription),
    simulatorModel: modelOverrideSchema.nullish().describe(simulatorModelDescription),
    judgeModel: modelOverrideSchema.nullish().describe(judgeModelDescription),
    maxTurns: z.number().int().min(1).max(100).nullish().describe(maxTurnsDescription),
    minTurns: z.number().int().min(0).max(100).nullish().describe(minTurnsDescription),
    testSuiteId: z.string().nullish().describe(testSuiteIdDescription),
    fields: scenarioFieldValuesSchema
      .optional()
      .describe(
        "The value for each field the test suite declares, keyed by field identifier: text, a number or a boolean, in the field's own type. A field the suite does not declare answers 422 scenario_field_unknown; a value of the wrong type answers 422 scenario_field_type_invalid. An empty value clears the field. Send the full record; an empty record clears every value.",
      ),
  })
  .strict();
export interface ScenarioRestUpdateSchema extends Named<
  typeof scenarioRestUpdateSchemaDefinition
> {}
export const scenarioRestUpdateSchema: ScenarioRestUpdateSchema =
  scenarioRestUpdateSchemaDefinition;

const scenarioRestIdParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface ScenarioRestIdParamsSchema extends Named<
  typeof scenarioRestIdParamsSchemaDefinition
> {}
export const scenarioRestIdParamsSchema: ScenarioRestIdParamsSchema =
  scenarioRestIdParamsSchemaDefinition;
const scenarioRestIdVersionParamsSchemaDefinition = z.object({
  ...scenarioRestIdParamsSchema.shape,
  version: z.coerce.number().int().min(1),
});
export interface ScenarioRestIdVersionParamsSchema extends Named<
  typeof scenarioRestIdVersionParamsSchemaDefinition
> {}
export const scenarioRestIdVersionParamsSchema: ScenarioRestIdVersionParamsSchema =
  scenarioRestIdVersionParamsSchemaDefinition;
const scenarioRestArchivedSchemaDefinition = z.object({ id: z.string(), archived: z.boolean() });
export interface ScenarioRestArchivedSchema extends Named<
  typeof scenarioRestArchivedSchemaDefinition
> {}
export const scenarioRestArchivedSchema: ScenarioRestArchivedSchema =
  scenarioRestArchivedSchemaDefinition;

/** `POST /api/v1/agents/:id/test`'s path: the agent under test, as agent published it. */
const agentTestRestParamsSchemaDefinition = z.object({
  id: z.string().min(1).describe("The agent id."),
});
export interface AgentTestRestParamsSchema extends Named<
  typeof agentTestRestParamsSchemaDefinition
> {}
export const agentTestRestParamsSchema: AgentTestRestParamsSchema =
  agentTestRestParamsSchemaDefinition;

/** A test run takes no body: the agent travels in the path. */
const testAgentBodySchemaDefinition = z.object({});
export interface TestAgentBodySchema extends Named<typeof testAgentBodySchemaDefinition> {}
export const testAgentBodySchema: TestAgentBodySchema = testAgentBodySchemaDefinition;

const agentTestRunResponseSchemaDefinition = z.object({
  scenarioRunId: z.string().describe("The run to follow; open it in the simulations run drawer."),
  batchRunId: z.string().describe("The batch the run belongs to."),
  setId: z.string().describe("The internal set that holds agent test runs."),
});
export interface AgentTestRunResponseSchema extends Named<
  typeof agentTestRunResponseSchemaDefinition
> {}
export const agentTestRunResponseSchema: AgentTestRunResponseSchema =
  agentTestRunResponseSchemaDefinition;
