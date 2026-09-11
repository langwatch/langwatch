import { z } from "zod";

/**
 * Typed inputs for the fields a test suite declares, the evaluators attached
 * to a suite or a run plan, and the values a scenario carries per field.
 *
 * Each one mirrors the zod the platform validates the REST body with
 * (`suiteFieldDefinitionsSchema`, `evaluatorAttachmentsSchema` and
 * `scenarioFieldValuesSchema` on the server side), so an agent is told what
 * is accepted before the request goes out rather than after.
 */

/** The value types a field can hold. */
export const SUITE_FIELD_TYPES = ["text", "number", "boolean"] as const;

/** One field a test suite declares. */
export const suiteFieldSchema = z.object({
  identifier: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Lowercase letters, digits and underscores, starting with a letter",
    )
    .describe(
      "The field name, as scenarios and evaluator mappings address it, for example golden_sql. Lowercase letters, digits and underscores, starting with a letter. situation, criteria, name, input and output are reserved.",
    ),
  type: z
    .enum(SUITE_FIELD_TYPES)
    .describe("The value type every scenario carries for this field."),
});

/** The fields a test suite declares, in the order the platform shows them. */
export const suiteFieldsSchema = z
  .array(suiteFieldSchema)
  .max(30)
  .describe(
    "The fields the test suite declares, in order. Up to 30. Every scenario filed in the suite carries one value per field, and an evaluator attached to the suite reads them through its mappings.",
  );

/** The sources an evaluator input can read from. */
export const SCENARIO_MAPPING_SOURCE_IDS = [
  "conversation",
  "scenario",
  "trace",
] as const;

/** Where one evaluator input reads its value: a source path or a literal. */
export const scenarioMappingSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("source"),
      sourceId: z
        .enum(SCENARIO_MAPPING_SOURCE_IDS)
        .describe(
          "conversation, scenario or trace. See discover_schema({ category: 'scenarios' }) for the paths each one offers.",
        ),
      path: z
        .array(z.string().min(1).max(256))
        .min(1)
        .max(3)
        .describe(
          "The path inside the source. conversation: [first_user_message] | [last_agent_message] | [transcript] | [messages]. scenario: [situation] | [criteria] | [fields, <identifier>]. trace: [contexts] | [tool_calls, <toolName>, input|output].",
        ),
    }),
    z.object({
      type: z.literal("value"),
      value: z.string().max(65_536).describe("A literal the input reads."),
    }),
  ])
  .describe(
    "Where one evaluator input reads its value: a path into the conversation, the scenario or the trace, or a literal value.",
  );

/** One evaluator attached to a test suite or a run plan. */
export const evaluatorAttachmentSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "The attachment id, stable across edits. Leave it out on a new attachment and one is generated.",
    ),
  evaluatorId: z
    .string()
    .min(1)
    .describe(
      "The id of the saved evaluator to run. Read it from platform_list_evaluators or platform_get_evaluator.",
    ),
  required: z
    .boolean()
    .optional()
    .describe(
      "Whether a failing result fails the scenario. Defaults to true. A score-only evaluator reports and never gates, whatever this says.",
    ),
  mappings: z
    .record(z.string().min(1).max(128), scenarioMappingSchema)
    .describe(
      "Where each evaluator input reads its value, keyed by input name. Read the inputs from platform_get_evaluator. A required input with no mapping makes the platform refuse the run until it is set.",
    ),
});

/** The evaluators attached to a test suite or a run plan. */
export const evaluatorAttachmentsSchema = z
  .array(evaluatorAttachmentSchema)
  .max(20)
  .describe(
    "The evaluators that run after every scenario run, with their mappings. Up to 20. A required evaluator that fails fails the scenario; a score-only one reports beside the verdict.",
  );

/** The values a scenario carries for the fields its suite declares. */
export const scenarioFieldValuesSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .describe(
    "The scenario's value for each field its test suite declares, by identifier, for example { golden_sql: 'SELECT ...' }. A text field takes a string, a number field a number and a boolean field true or false. A field the suite does not declare is refused. On update, an empty object clears the values.",
  );

export type SuiteField = z.infer<typeof suiteFieldSchema>;
export type ScenarioMapping = z.infer<typeof scenarioMappingSchema>;
export type EvaluatorAttachmentInput = z.infer<typeof evaluatorAttachmentSchema>;
export type ScenarioFieldValues = z.infer<typeof scenarioFieldValuesSchema>;

/** One attachment as the REST surface carries it: id and gate settled. */
export interface EvaluatorAttachmentWire {
  id: string;
  evaluatorId: string;
  required: boolean;
  mappings: Record<string, ScenarioMapping>;
}

const newAttachmentId = (): string =>
  `att_${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`;

/**
 * The attachments of a tool call, as the REST body carries them: a missing
 * id is generated and a missing gate defaults to required.
 */
export function toWireAttachments(
  attachments: EvaluatorAttachmentInput[],
): EvaluatorAttachmentWire[] {
  return attachments.map((attachment) => ({
    id: attachment.id ?? newAttachmentId(),
    evaluatorId: attachment.evaluatorId,
    required: attachment.required ?? true,
    mappings: attachment.mappings,
  }));
}
