import type { Named } from "@langwatch/module";
import { z } from "zod";

const codeEvaluatorFieldSchemaDefinition = z
  .object({
    identifier: z.string().min(1),
    type: z.string().min(1),
  })
  .strict();
export interface CodeEvaluatorFieldSchema extends Named<
  typeof codeEvaluatorFieldSchemaDefinition
> {}
export const codeEvaluatorFieldSchema: CodeEvaluatorFieldSchema =
  codeEvaluatorFieldSchemaDefinition;
const codeEvaluatorConfigSchemaDefinition = z
  .object({
    code: z.string().min(1),
    inputs: z.array(codeEvaluatorFieldSchema).min(1),
    outputs: z.array(codeEvaluatorFieldSchema).min(1),
  })
  .strict();
export interface CodeEvaluatorConfigSchema extends Named<
  typeof codeEvaluatorConfigSchemaDefinition
> {}
export const codeEvaluatorConfigSchema: CodeEvaluatorConfigSchema =
  codeEvaluatorConfigSchemaDefinition;
export type CodeEvaluatorConfig = z.infer<typeof codeEvaluatorConfigSchema>;

export type CodeEvaluatorExecutionInput = {
  projectId: string;
  evaluatorId: string;
  data: Record<string, unknown>;
  traceId?: string;
  parentCausalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
  /** The member the run acts as, when one started it; absent, the run key has no owner. */
  principal?: { userId: string } | undefined;
};

/** The fixed result fields a stored code evaluator may return. */
export const codeEvaluatorOutputFields = [
  { identifier: "details", type: "str" },
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
] as const;

/** A code evaluator's config with the full result contract, as the editor stores it. */
export function withCodeEvaluatorOutputFields<T extends Record<string, unknown>>(
  config: T,
): T & { outputs: CodeEvaluatorConfig["outputs"] } {
  return { ...config, outputs: codeEvaluatorOutputFields.map((field) => ({ ...field })) };
}

const isContractOutputField = (field: { identifier: string; type: string }): boolean =>
  codeEvaluatorOutputFields.some(
    (fixed) => fixed.identifier === field.identifier && fixed.type === field.type,
  );

/**
 * A code evaluator's config as a create names it. The result fields are the fixed
 * contract, so they may be left out; any that are named must belong to it.
 */
const codeEvaluatorCreateConfigSchemaDefinition = z
  .object({
    code: z.string().min(1),
    inputs: z.array(codeEvaluatorFieldSchema).min(1),
    outputs: z.array(codeEvaluatorFieldSchema).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (!config.outputs || config.outputs.every(isContractOutputField)) return;
    ctx.addIssue({
      code: "custom",
      path: ["outputs"],
      message:
        "A code evaluator's outputs are fixed: passed (bool), score (float), label (str) and details (str). Leave them out or name only those.",
    });
  });
export interface CodeEvaluatorCreateConfigSchema extends Named<
  typeof codeEvaluatorCreateConfigSchemaDefinition
> {}
export const codeEvaluatorCreateConfigSchema: CodeEvaluatorCreateConfigSchema =
  codeEvaluatorCreateConfigSchemaDefinition;

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
/** The evaluator id a `code/…` check type names; any other check type is refused. */
export const getCodeEvaluatorId = (value: string): string => {
  if (!isCodeEvaluatorCheckType(value)) {
    throw new Error(`"${value}" is not a code evaluator check type`);
  }
  return value.slice(CODE_EVALUATOR_CHECK_PREFIX.length);
};
