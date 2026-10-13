import type { TRACE_MAPPINGS } from "@langwatch/dataset-contract";
import { isLlmJudgeEvaluator } from "@langwatch/evaluator-contract";
import type { FieldMapping as UIFieldMapping } from "@langwatch/workflow-contract";

/** What auto-inference reads of an evaluator: its type and its field identifiers. */
export interface AutoInferEvaluator {
  config?: unknown;
  fields?: readonly { identifier: string }[] | null;
}

/** Auto-inferred mappings for standard evaluator fields. */
const AUTO_INFER_MAPPINGS: Record<string, keyof typeof TRACE_MAPPINGS> = {
  input: "input",
  output: "output",
  contexts: "contexts",
  "contexts.string_list": "contexts.string_list",
};

/**
 * Auto-infer mappings for standard fields (both required and optional). An
 * LLM judge's input reads the whole trace, or the thread's steps view, so the
 * tool calls and results it may be asked about are in what it reads.
 * @see specs/evaluators/judges-read-tool-evidence.feature
 */
export function autoInferMappings({
  evaluator,
  level,
}: {
  evaluator: AutoInferEvaluator | null | undefined;
  level: "trace" | "thread" | null;
}): Record<string, UIFieldMapping> {
  const evaluatorType = (evaluator?.config as { evaluatorType?: unknown } | null | undefined)
    ?.evaluatorType;
  const judge = typeof evaluatorType === "string" && isLlmJudgeEvaluator(evaluatorType);
  const mappings: Record<string, UIFieldMapping> = {};
  for (const { identifier } of evaluator?.fields ?? []) {
    const mapping = inferFieldMapping({ field: identifier, level, judge });
    if (mapping) mappings[identifier] = mapping;
  }
  return mappings;
}

function inferFieldMapping({
  field,
  level,
  judge,
}: {
  field: string;
  level: "trace" | "thread" | null;
  judge: boolean;
}): UIFieldMapping | undefined {
  if (level === "thread") {
    if (field !== "input") return undefined;
    return { type: "source", sourceId: "thread", path: [judge ? "formatted_traces" : "traces"] };
  }
  if (level !== "trace") return undefined;
  const source = judge && field === "input" ? "formatted_trace" : AUTO_INFER_MAPPINGS[field];
  return source ? { type: "source", sourceId: "trace", path: [source] } : undefined;
}
