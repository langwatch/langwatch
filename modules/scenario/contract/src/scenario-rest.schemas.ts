import { z } from "zod";
import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import {
  scenarioParameterDefinitionSchema,
  scenarioParameterDefinitionsSchema,
} from "./scenario.parameters.ts";

/** The shared bare `{ error }` body the pre-conversion scenario families answer a miss with. */
export const scenarioLegacyErrorBodySchema = z.object({ error: z.string() });

export const scenarioRestResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
  parameters: z.array(scenarioParameterDefinitionSchema),
  /**
   * The five fields below are optional in the document, not in the answer:
   * every server sends them. They arrived after clients were generated from
   * this family, and a client that reads one as required fails against a
   * server that predates it.
   *
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
});

export const scenarioRestResponseWithPlatformUrlSchema = scenarioRestResponseSchema.extend({
  platformUrl: z.string().url(),
});

export const scenarioRestVersionSummarySchema = z.object({
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

export const scenarioRestVersionListResponseSchema = z.object({
  versions: z.array(scenarioRestVersionSummarySchema),
  nextCursor: z
    .number()
    .int()
    .nullable()
    .describe("Pass as cursor to read the page below this one. Null on the last page."),
});

export const scenarioRestVersionDetailResponseSchema = scenarioRestVersionSummarySchema.extend({
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
    })
    .describe("The editable content of the case as this version saved it."),
});

export const scenarioRestListVersionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Read the page below this version number."),
});

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

export const scenarioRestCreateSchema = z.object({
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
});

export const scenarioRestUpdateSchema = z.object({
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
});

export const scenarioRestIdParamsSchema = z.object({ id: z.string().min(1) });
export const scenarioRestIdVersionParamsSchema = scenarioRestIdParamsSchema.extend({
  version: z.coerce.number().int().min(1),
});
export const scenarioRestArchivedSchema = z.object({ id: z.string(), archived: z.boolean() });
