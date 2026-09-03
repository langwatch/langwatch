/**
 * Evaluator attachments: which saved evaluators a suite or a run plan runs
 * after each scenario, and where each evaluator input reads its value from.
 *
 * A mapping is stored in the shape the variable mapping picker edits, with no
 * converter between the two: `{ type: "source", sourceId, path }` or
 * `{ type: "value", value }`. The three sources are the conversation, the
 * scenario (its situation, its criteria, or one of the suite's fields) and the
 * trace the run produced (retrieved contexts, or a tool call's input or
 * output).
 *
 * Mappings are inferred when an evaluator is attached. Tool calls are never
 * inferred: a wrong guess there reads the wrong call and grades it. A plan
 * level attachment never reads scenario fields, because a run plan may cover
 * scenarios from several suites with different fields.
 *
 * Framework-free on purpose: the client, the domain and the run worker all
 * import it. The one component type it names is imported as a type only.
 *
 * @see specs/suites/test-suites.feature
 * @see specs/scenarios/scenario-evaluators.feature
 */

import { z } from "zod";
import type {
  AvailableSource,
  NestedField,
} from "~/components/variables/VariableMappingInput";
import type { SuiteFieldDefinition } from "./suite-fields";

/** The sources an evaluator input can read from. */
export const SCENARIO_MAPPING_SOURCE_IDS = [
  "conversation",
  "scenario",
  "trace",
] as const;
export type ScenarioMappingSourceId =
  (typeof SCENARIO_MAPPING_SOURCE_IDS)[number];

/** The paths under the conversation source. */
export const CONVERSATION_PATHS = [
  "first_user_message",
  "last_agent_message",
  "transcript",
  "messages",
] as const;
export type ConversationPath = (typeof CONVERSATION_PATHS)[number];

/** The scalar paths under the scenario source; a field is `["fields", id]`. */
export const SCENARIO_PATHS = ["situation", "criteria"] as const;

/** The first segment of the two trace paths. */
export const TRACE_CONTEXTS_PATH = "contexts";
export const TRACE_TOOL_CALLS_PATH = "tool_calls";
export const TOOL_CALL_PARTS = ["input", "output"] as const;

/** How many evaluators one suite or plan may attach. */
export const MAX_EVALUATOR_ATTACHMENTS = 20;

/** How long a literal mapping value may be. */
export const MAX_MAPPING_VALUE_LENGTH = 65_536;

export const scenarioMappingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("source"),
    sourceId: z.enum(SCENARIO_MAPPING_SOURCE_IDS),
    path: z.array(z.string().min(1).max(256)).min(1).max(3),
  }),
  z.object({
    type: z.literal("value"),
    value: z.string().max(MAX_MAPPING_VALUE_LENGTH),
  }),
]);
export type ScenarioMapping = z.infer<typeof scenarioMappingSchema>;

export const evaluatorAttachmentSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .describe("The attachment id. Stable across edits of the attachment."),
  evaluatorId: z
    .string()
    .min(1)
    .describe("The id of the saved evaluator this attachment runs."),
  required: z
    .boolean()
    .describe(
      "Whether a failing result fails the scenario. A score-only evaluator reports and never gates.",
    ),
  mappings: z
    .record(z.string().min(1).max(128), scenarioMappingSchema)
    .describe(
      "Where each evaluator input reads its value from, keyed by input name.",
    ),
});
export type EvaluatorAttachment = z.infer<typeof evaluatorAttachmentSchema>;

export const evaluatorAttachmentsSchema = z
  .array(evaluatorAttachmentSchema)
  .max(MAX_EVALUATOR_ATTACHMENTS);

/** Reads a stored `evaluators` column. Null and a bad shape both read as none. */
export function parseEvaluatorAttachments(raw: unknown): EvaluatorAttachment[] {
  if (raw === null || raw === undefined) return [];
  const parsed = evaluatorAttachmentsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** One input an evaluator declares, as much of it as the mapping rules read. */
export interface EvaluatorInputSpec {
  id: string;
  required: boolean;
}

/** What the mapping rules know about the suite and the target. */
export interface ScenarioMappingContext {
  fields: SuiteFieldDefinition[];
  /** Tool names seen on recent traces of the target. May be empty. */
  toolNames: string[];
}

export const SCENARIO_MISSING_MAPPING_TOOLTIP =
  "Missing variable mappings - Click to configure";

const FIELD_TYPE_TO_MAPPING_TYPE: Record<
  SuiteFieldDefinition["type"],
  NestedField["type"]
> = {
  text: "str",
  number: "float",
  boolean: "bool",
};

/** The conversation source, for the mapping picker. */
function conversationSource(): AvailableSource {
  return {
    id: "conversation",
    name: "Conversation",
    type: "agent",
    fields: [
      { name: "first_user_message", label: "First user message", type: "str" },
      { name: "last_agent_message", label: "Last agent message", type: "str" },
      { name: "transcript", label: "Transcript", type: "str" },
      { name: "messages", label: "Messages", type: "list" },
    ],
  };
}

/** The scenario source: situation, criteria and the suite's fields. */
function scenarioSource({
  fields,
  planLevel,
}: {
  fields: SuiteFieldDefinition[];
  planLevel: boolean;
}): AvailableSource {
  const scenarioFields: NestedField[] = [
    { name: "situation", label: "Situation", type: "str" },
    { name: "criteria", label: "Criteria", type: "str" },
  ];
  if (!planLevel && fields.length > 0) {
    scenarioFields.push({
      name: "fields",
      label: "Fields",
      type: "dict",
      children: fields.map((field) => ({
        name: field.identifier,
        type: FIELD_TYPE_TO_MAPPING_TYPE[field.type],
      })),
    });
  }
  return {
    id: "scenario",
    name: "Scenario",
    type: "dataset",
    fields: scenarioFields,
  };
}

/** The trace source: retrieved contexts and the tool calls seen so far. */
function traceSource({ toolNames }: { toolNames: string[] }): AvailableSource {
  const toolCalls: NestedField = {
    name: TRACE_TOOL_CALLS_PATH,
    label: "Tool calls",
    type: "dict",
    children: toolNames.map((toolName) => ({
      name: toolName,
      type: "dict",
      children: TOOL_CALL_PARTS.map((part) => ({ name: part, type: "str" })),
    })),
  };
  return {
    id: "trace",
    name: "Trace",
    type: "custom",
    fields: [
      {
        name: TRACE_CONTEXTS_PATH,
        label: "Retrieved contexts",
        type: "list",
      },
      toolCalls,
    ],
  };
}

/**
 * The three sources with their field trees, for the mapping section of the
 * evaluator drawer. A plan level attachment gets the scenario source without
 * the suite fields.
 */
export function scenarioMappingSources(
  ctx: ScenarioMappingContext,
  options?: { planLevel?: boolean },
): AvailableSource[] {
  const planLevel = options?.planLevel ?? false;
  return [
    conversationSource(),
    scenarioSource({ fields: ctx.fields, planLevel }),
    traceSource({ toolNames: ctx.toolNames }),
  ];
}

const INPUT_LIKE = new Set(["input", "question", "user_input", "query"]);
const OUTPUT_LIKE = new Set(["output", "response", "answer", "result"]);
const TRANSCRIPT_LIKE = new Set(["transcript", "conversation", "messages"]);
const CONTEXTS_LIKE = new Set(["contexts", "retrieved_contexts", "context"]);
const EXPECTED_LIKE = new Set(["golden", "reference", "ground_truth"]);

/**
 * The words of a field identifier an expected-like input may be answered by.
 * `expected_output` reads the golden answer; `expected_contexts` reads the
 * schema or the tables the answer was written against.
 */
const EXPECTED_FIELD_WORDS: Record<string, readonly string[]> = {
  expected_output: [
    "expected",
    "golden",
    "reference",
    "answer",
    "sql",
    "query",
    "label",
    "target",
  ],
  expected_contexts: [
    "schema",
    "schemas",
    "context",
    "contexts",
    "table",
    "tables",
  ],
};

const DEFAULT_EXPECTED_WORDS = [
  "expected",
  "golden",
  "reference",
  "ground_truth",
  "truth",
] as const;

/** Whether an input reads a golden or reference value a scenario carries. */
export function isExpectedLikeInput(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.startsWith("expected") || EXPECTED_LIKE.has(lower);
}

const wordsOf = (identifier: string): string[] =>
  identifier.toLowerCase().split("_").filter(Boolean);

/**
 * The one field an expected-like input reads, or none.
 *
 * An exact identifier match wins. Otherwise the input's word list is compared
 * with each field's words and a single candidate is taken; two candidates
 * mean a guess, and a guess is worse than an empty mapping the person fills
 * in. With no word match at all, a suite with exactly one field maps to it:
 * there is nothing else the input could mean.
 */
function inferExpectedField({
  inputId,
  fields,
}: {
  inputId: string;
  fields: SuiteFieldDefinition[];
}): SuiteFieldDefinition | undefined {
  const lower = inputId.toLowerCase();
  const exact = fields.find((field) => field.identifier === lower);
  if (exact) return exact;

  const words = new Set<string>([
    ...(EXPECTED_FIELD_WORDS[lower] ?? DEFAULT_EXPECTED_WORDS),
    ...wordsOf(lower).filter((word) => word !== "expected"),
  ]);
  const candidates = fields.filter((field) =>
    wordsOf(field.identifier).some((word) => words.has(word)),
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0 && fields.length === 1) return fields[0];
  return undefined;
}

const source = (
  sourceId: ScenarioMappingSourceId,
  path: string[],
): ScenarioMapping => ({ type: "source", sourceId, path });

/**
 * The mapping one input gets on attach, or none when nothing reads as the
 * obvious source for it.
 */
export function inferScenarioMapping({
  inputId,
  ctx,
  planLevel,
}: {
  inputId: string;
  ctx: ScenarioMappingContext;
  planLevel?: boolean;
}): ScenarioMapping | undefined {
  const lower = inputId.toLowerCase();
  if (INPUT_LIKE.has(lower)) {
    return source("conversation", ["first_user_message"]);
  }
  if (OUTPUT_LIKE.has(lower)) {
    return source("conversation", ["last_agent_message"]);
  }
  if (TRANSCRIPT_LIKE.has(lower)) {
    return source("conversation", ["transcript"]);
  }
  if (CONTEXTS_LIKE.has(lower)) {
    return source("trace", [TRACE_CONTEXTS_PATH]);
  }
  if (isExpectedLikeInput(lower)) {
    if (planLevel) return undefined;
    const field = inferExpectedField({ inputId: lower, fields: ctx.fields });
    return field ? source("scenario", ["fields", field.identifier]) : undefined;
  }
  if (planLevel) return undefined;
  const field = ctx.fields.find((candidate) => candidate.identifier === lower);
  return field ? source("scenario", ["fields", field.identifier]) : undefined;
}

/**
 * The mappings an evaluator gets on attach, one per input the rules can
 * answer. Tool calls are never inferred. A plan level attachment never maps
 * to a scenario field.
 */
export function inferScenarioMappings({
  inputs,
  ctx,
  planLevel,
}: {
  inputs: EvaluatorInputSpec[];
  ctx: ScenarioMappingContext;
  planLevel?: boolean;
}): Record<string, ScenarioMapping> {
  const mappings: Record<string, ScenarioMapping> = {};
  for (const input of inputs) {
    const mapping = inferScenarioMapping({ inputId: input.id, ctx, planLevel });
    if (mapping) mappings[input.id] = mapping;
  }
  return mappings;
}

/** Whether a mapping names a source or a value at all. */
function mappingIsSet(mapping: ScenarioMapping | undefined): boolean {
  if (!mapping) return false;
  if (mapping.type === "value") return mapping.value.length > 0;
  return mapping.path.length > 0;
}

/** The required inputs the attachment has no mapping for. */
export function attachmentMissingInputs({
  attachment,
  inputs,
}: {
  attachment: Pick<EvaluatorAttachment, "mappings">;
  inputs: EvaluatorInputSpec[];
}): EvaluatorInputSpec[] {
  return inputs.filter(
    (input) => input.required && !mappingIsSet(attachment.mappings[input.id]),
  );
}

/**
 * Whether attaching this evaluator opens its drawer right away: a required
 * input is still unmapped, or an expected-like input exists and the person
 * must confirm which field it reads.
 */
export function attachmentOpensOnAttach({
  attachment,
  inputs,
}: {
  attachment: Pick<EvaluatorAttachment, "mappings">;
  inputs: EvaluatorInputSpec[];
}): boolean {
  if (attachmentMissingInputs({ attachment, inputs }).length > 0) return true;
  return inputs.some((input) => isExpectedLikeInput(input.id));
}

const pathText = (path: readonly string[]): string => path.join(".");

function conversationPathIssue(path: readonly string[]): string | null {
  const [head] = path;
  const known = (CONVERSATION_PATHS as readonly string[]).includes(head ?? "");
  return path.length === 1 && known
    ? null
    : `The conversation has no ${pathText(path)}`;
}

function scenarioPathIssue({
  path,
  ctx,
  planLevel,
}: {
  path: readonly string[];
  ctx: Pick<ScenarioMappingContext, "fields">;
  planLevel: boolean;
}): string | null {
  const [head, second] = path;
  if (
    path.length === 1 &&
    (SCENARIO_PATHS as readonly string[]).includes(head ?? "")
  ) {
    return null;
  }
  if (head !== "fields" || path.length !== 2 || !second) {
    return `The scenario has no ${pathText(path)}`;
  }
  if (planLevel) return "A run plan evaluator cannot read a scenario field";
  return ctx.fields.some((field) => field.identifier === second)
    ? null
    : `The suite declares no field named ${second}`;
}

function tracePathIssue(path: readonly string[]): string | null {
  const [head, second, third] = path;
  if (path.length === 1 && head === TRACE_CONTEXTS_PATH) return null;
  const isToolCall =
    head === TRACE_TOOL_CALLS_PATH &&
    path.length === 3 &&
    !!second &&
    (TOOL_CALL_PARTS as readonly string[]).includes(third ?? "");
  return isToolCall ? null : `The trace has no ${pathText(path)}`;
}

/**
 * Why a mapping path cannot be read, or null when it can.
 *
 * Checked when an attachment is saved, so a run never meets a path it does
 * not know. The field a scenario path names must be one the suite declares;
 * a plan level attachment names no field at all.
 */
export function scenarioMappingPathIssue({
  mapping,
  ctx,
  planLevel,
}: {
  mapping: ScenarioMapping;
  ctx: Pick<ScenarioMappingContext, "fields">;
  planLevel?: boolean;
}): string | null {
  if (mapping.type === "value") return null;
  switch (mapping.sourceId) {
    case "conversation":
      return conversationPathIssue(mapping.path);
    case "scenario":
      return scenarioPathIssue({
        path: mapping.path,
        ctx,
        planLevel: planLevel ?? false,
      });
    case "trace":
      return tracePathIssue(mapping.path);
  }
}

/** The field identifiers the attachments read through scenario mappings. */
export function fieldIdentifiersReadBy(
  attachments: readonly Pick<EvaluatorAttachment, "mappings">[],
): Set<string> {
  const identifiers = new Set<string>();
  for (const attachment of attachments) {
    for (const mapping of Object.values(attachment.mappings)) {
      if (
        mapping.type === "source" &&
        mapping.sourceId === "scenario" &&
        mapping.path[0] === "fields" &&
        mapping.path[1]
      ) {
        identifiers.add(mapping.path[1]);
      }
    }
  }
  return identifiers;
}
