/**
 * Shared harness for the scenario evaluator editor integration tests: the
 * Chakra wrapper, the fixtures, and the real drawer body and footer over a
 * real form with a fully wired controller. The `vi.mock` calls stay in each
 * test file, since they have to hoist above that file's own imports.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type React from "react";
import { type FieldValues, useForm } from "react-hook-form";
import { vi } from "vitest";

import {
  EvaluatorEditorBody,
  type EvaluatorEditorController,
  EvaluatorEditorFooter,
  type EvaluatorGateConfig,
} from "~/components/evaluators/EvaluatorEditorShared";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import { scenarioMappingSources } from "~/server/scenarios/evaluator-attachments";
import type { AttachableEvaluator } from "../evaluators/attachment-rules";
import { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";

export const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
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

function buildController({
  form,
  gate,
  required,
  onRequiredChange,
  onRemove,
  onMappingChange,
}: {
  form: ReturnType<typeof useForm>;
  gate: EvaluatorGateConfig | undefined;
  required: boolean;
  onRequiredChange?: (required: boolean) => void;
  onRemove?: () => void;
  onMappingChange: (identifier: string, mapping: unknown) => void;
}): EvaluatorEditorController {
  return {
    form,
    evaluatorId: "eval_sql",
    evaluatorType: "ragas/sql_query_equivalence",
    evaluatorDef: undefined,
    effectiveEvaluatorDef: {
      requiredFields: ["output", "expected_output", "expected_contexts"],
      optionalFields: [],
    },
    isLoadingEvaluator: false,
    workflowCard: undefined,
    isWorkflowEvaluator: false,
    hasSettings: false,
    settingsSchema: undefined,
    projectSlug: "p1",
    hasUnsavedChanges: false,
    isSaving: false,
    isValid: true,
    saveButtonText: undefined,
    mappingsConfig: {
      availableSources: scenarioMappingSources({
        fields: SUITE_FIELDS,
        toolNames: ["run_sql"],
      }),
      initialMappings: {
        output: {
          type: "source",
          sourceId: "conversation",
          path: ["last_agent_message"],
        },
      },
    },
    onMappingChange,
    comparisonContext: undefined,
    expectsComparisonContext: false,
    comparison: {
      variants: [],
      hasGoldenAnswer: true,
      goldenField: "",
      includeMetrics: [],
      randomizeOrder: true,
    },
    onComparisonChange: undefined,
    onLocalConfigChange: undefined,
    gate,
    required,
    onRequiredChange,
    onRemove,
    title: "SQL Query Equivalence",
    handleSave: vi.fn(),
    handleClose: vi.fn(),
    handleDiscard: vi.fn(),
    handleApply: vi.fn(),
    flushLocalConfig: vi.fn(),
  } as unknown as EvaluatorEditorController;
}

/** The real drawer body and footer over a real form, with the gate wired. */
export function Harness({
  gate,
  required,
  onRequiredChange,
  onRemove,
  onMappingChange = vi.fn(),
}: {
  gate: EvaluatorGateConfig | undefined;
  required: boolean;
  onRequiredChange?: (required: boolean) => void;
  onRemove?: () => void;
  onMappingChange?: (identifier: string, mapping: unknown) => void;
}) {
  const form = useForm<FieldValues>({
    defaultValues: { name: "SQL Equivalence", settings: {} },
  });
  const controller = buildController({
    form,
    gate,
    required,
    onRequiredChange,
    onRemove,
    onMappingChange,
  });

  return (
    <>
      <EvaluatorEditorBody controller={controller} />
      <EvaluatorEditorFooter controller={controller} />
    </>
  );
}

/** A button that opens the editor the way a chip does. */
export function OpenEditor({
  evaluator,
  onMappingChange,
  onRequiredChange,
  onRemove,
}: {
  evaluator: AttachableEvaluator;
  onMappingChange: (input: string, mapping: unknown) => void;
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
