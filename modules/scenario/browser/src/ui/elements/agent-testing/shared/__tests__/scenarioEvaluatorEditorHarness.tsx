/**
 * Shared harness for the scenario evaluator editor tests: the design-system wrapper, the fixtures,
 * and a chip-like button that opens the editor through scenario's own hook. `vi.mock` calls stay
 * per test file, since they hoist above its imports.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { EvaluatorAttachment } from "@langwatch/scenario-contract";
import type React from "react";

import { useOpenScenarioEvaluatorEditor } from "../../../../../behavior/agent-testing/evaluators/use-open-scenario-evaluator-editor.ts";
import type { AttachableEvaluator } from "../../../../../model/agent-testing/evaluators/attachment-rules.ts";

export const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

export const SUITE_FIELDS = [
  { identifier: "golden_sql", type: "text" as const },
  { identifier: "table_schema", type: "text" as const },
];

export const ATTACHMENT: EvaluatorAttachment = {
  id: "att_1",
  evaluatorId: "eval_sql",
  required: true,
  mappings: {
    output: {
      type: "source",
      sourceId: "conversation",
      path: ["last_agent_message"],
    },
  },
};

export const SQL_EVALUATOR: AttachableEvaluator = {
  id: "eval_sql",
  name: "SQL Query Equivalence",
  type: "evaluator",
  config: { evaluatorType: "ragas/sql_query_equivalence", settings: {} },
  fields: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
    { identifier: "expected_contexts", type: "str" },
  ],
  outputFields: [
    { identifier: "passed", type: "bool" },
    { identifier: "score", type: "float" },
  ],
};

/** A button that opens the editor the way a chip does. */
export function OpenEditor({
  evaluator,
  onMappingChange,
  onRequiredChange,
  onRemove,
}: {
  evaluator: AttachableEvaluator;
  onMappingChange: (change: { input: string; mapping: unknown }) => void;
  onRequiredChange: (required: boolean) => void;
  onRemove: () => void;
}) {
  const open = useOpenScenarioEvaluatorEditor();
  return (
    <button
      type="button"
      onClick={() =>
        open({
          attachment: ATTACHMENT,
          evaluator,
          ctx: { fields: SUITE_FIELDS, toolNames: ["run_sql"] },
          onMappingChange,
          onRequiredChange,
          onRemove,
        })
      }
    >
      Open
    </button>
  );
}
