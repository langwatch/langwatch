import { z } from "zod";

export const codeEvaluatorFieldSchema = z
  .object({
    identifier: z.string().min(1),
    type: z.string().min(1),
  })
  .strict();
export const codeEvaluatorConfigSchema = z
  .object({
    code: z.string().min(1),
    inputs: z.array(codeEvaluatorFieldSchema).min(1),
    outputs: z.array(codeEvaluatorFieldSchema).min(1),
  })
  .strict();
export type CodeEvaluatorConfig = z.infer<typeof codeEvaluatorConfigSchema>;

export type CodeEvaluatorExecutionInput = {
  projectId: string;
  evaluatorId: string;
  data: Record<string, unknown>;
  traceId?: string;
  parentCausalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
};

/** The fixed result fields a stored code evaluator may return. */
export const codeEvaluatorOutputFields = [
  { identifier: "details", type: "str" },
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
] as const;

/** The editor seed for a new stored code evaluator. */
export const defaultCodeEvaluatorConfig: CodeEvaluatorConfig = {
  code: `class Code:
    def __call__(self, output: str, expected_output: str):
        # Return any subset of: passed, score, label, details.
        passed = output.strip() == expected_output.strip()

        return {"passed": passed, "score": 1.0 if passed else 0.0}
`,
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  outputs: codeEvaluatorOutputFields.map((field) => ({ ...field })),
};

export const CODE_EVALUATOR_CHECK_PREFIX = "code/";
export const isCodeEvaluatorCheckType = (value: string): boolean =>
  value.startsWith(CODE_EVALUATOR_CHECK_PREFIX);
export const codeEvaluatorIdFromCheckType = (value: string): string | undefined =>
  isCodeEvaluatorCheckType(value) ? value.slice(CODE_EVALUATOR_CHECK_PREFIX.length) : undefined;
