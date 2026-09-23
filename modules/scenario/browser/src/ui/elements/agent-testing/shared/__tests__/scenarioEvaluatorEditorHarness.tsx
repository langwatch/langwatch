/**
 * Shared harness for the scenario evaluator editor integration tests: the
 * Chakra wrapper, fixtures, and the real drawer body/footer over a fully
 * wired form. `vi.mock` calls stay per test file, needing to hoist above its imports.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  EvaluatorEditorBody,
  type EvaluatorEditorController,
  EvaluatorEditorFooter,
  type EvaluatorGateConfig,
} from "@langwatch/evaluator-browser/surfaces/evaluator-editor-shared";
import { type EvaluatorAttachment, scenarioMappingSources } from "@langwatch/scenario-contract";
import type React from "react";
import { useForm } from "react-hook-form";
import { vi } from "vitest";

import { useOpenScenarioEvaluatorEditor } from "../../../../../behavior/agent-testing/evaluators/use-open-scenario-evaluator-editor.ts";
import type { AttachableEvaluator } from "../../../../../model/agent-testing/evaluators/attachment-rules.ts";

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

/** The parts of the controller that stay the same across every fixture. */
const STATIC_CONTROLLER_FIXTURE: Omit<
  EvaluatorEditorController,
  | "form"
  | "onMappingChange"
  | "gate"
  | "required"
  | "onRequiredChange"
  | "onRemove"
  | "handleSave"
  | "handleClose"
  | "handleDiscard"
  | "handleApply"
  | "flushLocalConfig"
> = {
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
      ctx: { fields: SUITE_FIELDS, toolNames: ["run_sql"] },
    }),
    initialMappings: {
      output: {
        type: "source",
        sourceId: "conversation",
        path: ["last_agent_message"],
      },
    },
  },
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
  title: "SQL Query Equivalence",
};

function buildController({
  form,
  gate,
  required,
  onRequiredChange,
  onRemove,
  onMappingChange,
}: {
  form: EvaluatorEditorController["form"];
  gate: EvaluatorGateConfig | undefined;
  required: boolean;
  onRequiredChange?: (required: boolean) => void;
  onRemove?: () => void;
  onMappingChange: (identifier: string, mapping: unknown) => void;
}): EvaluatorEditorController {
  return {
    ...STATIC_CONTROLLER_FIXTURE,
    form,
    onMappingChange,
    gate,
    required,
    onRequiredChange,
    onRemove,
    handleSave: vi.fn(),
    handleClose: vi.fn(),
    handleDiscard: vi.fn(),
    handleApply: vi.fn(),
    flushLocalConfig: vi.fn(),
  };
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
  const form = useForm<{ name: string; settings: Record<string, unknown> }>({
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
