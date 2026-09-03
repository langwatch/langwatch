import { z } from "zod";

export const EVALUATOR_FEATURE_ID = "evaluator" as const;
export const evaluatorTypeSchema = z.enum(["evaluator", "code", "workflow"]);
export type EvaluatorType = z.infer<typeof evaluatorTypeSchema>;

export const evaluatorFieldSchema = z
  .object({
    identifier: z.string().min(1),
    type: z.string().min(1),
    optional: z.boolean().optional(),
  })
  .strict();
export type EvaluatorField = z.infer<typeof evaluatorFieldSchema>;

export const evaluatorConfigSchema = z.record(z.string(), z.unknown());
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;

export const evaluatorSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1).nullable(),
    type: evaluatorTypeSchema,
    config: z.json().nullable(),
    workflowId: z.string().nullable(),
    copiedFromEvaluatorId: z.string().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    copyCount: z.number().int().nonnegative().optional(),
    _count: z.object({ copiedEvaluators: z.number().int().nonnegative() }).optional(),
  })
  .strict();
export type Evaluator = z.infer<typeof evaluatorSchema>;

export const standardEvaluatorOutputFields = [
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
] as const satisfies readonly EvaluatorField[];

export const evaluatorWithFieldsSchema = evaluatorSchema
  .extend({
    fields: z.array(evaluatorFieldSchema),
    outputFields: z.array(evaluatorFieldSchema),
    workflowName: z.string().optional(),
    workflowIcon: z.string().optional(),
  })
  .strict();
export type EvaluatorWithFields = z.infer<typeof evaluatorWithFieldsSchema>;

export type EvaluatorCategory =
  | "quality"
  | "rag"
  | "safety"
  | "policy"
  | "other"
  | "custom"
  | "similarity";

export type EvaluatorDefinition<_Type extends string = string> = {
  name: string;
  description: string;
  category: EvaluatorCategory;
  docsUrl?: string;
  isGuardrail: boolean;
  requiredFields: string[];
  optionalFields: string[];
  settings: Record<string, { description?: string; default: unknown }>;
  envVars: string[];
  result: {
    score?: { description: string };
    passed?: { description: string };
    label?: { description: string };
  };
};

export type CustomEvaluatorDefinition = {
  name: string;
  requiredFields: string[];
};

/** The catalogue's short presentation names are product vocabulary, not UI state. */
export const evaluatorDisplayNames: Readonly<Record<string, string>> = {
  "Azure Content Safety": "Content Safety",
  "OpenAI Moderation": "Moderation",
  "Azure Jailbreak Detection": "Jailbreak Detection",
  "Presidio PII Detection": "PII Detection",
  "Lingua Language Detection": "Language Detection",
  "Azure Prompt Shield": "Prompt Injection Detection",
};

export const evaluatorDisplayName = (name: string): string => evaluatorDisplayNames[name] ?? name;

export const fieldType = (fieldName: string): string =>
  ({
    contexts: "list",
    expected_contexts: "list",
    conversation: "list",
  })[fieldName] ?? "str";

export function getEvaluatorDefaultSettings(
  definition: EvaluatorDefinition | CustomEvaluatorDefinition | undefined,
  resolved: { defaultModel?: string | null; embeddingsModel?: string | null } = {},
  fallback: { defaultModel: string; embeddingsModel: string } = {
    defaultModel: "openai/gpt-5",
    embeddingsModel: "openai/text-embedding-3-small",
  },
): Record<string, unknown> {
  if (!definition || !("settings" in definition)) return {};
  return Object.fromEntries(
    Object.entries(definition.settings).map(([key, setting]) => [
      key,
      key === "model"
        ? (resolved.defaultModel ?? fallback.defaultModel)
        : key === "embeddings_model"
          ? (resolved.embeddingsModel ?? fallback.embeddingsModel)
          : setting.default,
    ]),
  );
}
