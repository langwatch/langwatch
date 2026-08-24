import { z } from "zod/v4";

export const codeEvaluatorFieldSchema = z.object({
  identifier: z.string().min(1),
  type: z.string().min(1),
}).strict();
export const codeEvaluatorConfigSchema = z.object({
  code: z.string().min(1),
  inputs: z.array(codeEvaluatorFieldSchema).min(1),
  outputs: z.array(codeEvaluatorFieldSchema).min(1),
}).strict();
export type CodeEvaluatorConfig = z.infer<typeof codeEvaluatorConfigSchema>;

export const codeEvaluatorOutputFields = [
  { identifier: "details", type: "str" },
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
] as const;

export const CODE_EVALUATOR_CHECK_PREFIX = "code/";
export const isCodeEvaluatorCheckType = (value: string): boolean =>
  value.startsWith(CODE_EVALUATOR_CHECK_PREFIX);
export const codeEvaluatorIdFromCheckType = (value: string): string | undefined =>
  isCodeEvaluatorCheckType(value)
    ? value.slice(CODE_EVALUATOR_CHECK_PREFIX.length)
    : undefined;
