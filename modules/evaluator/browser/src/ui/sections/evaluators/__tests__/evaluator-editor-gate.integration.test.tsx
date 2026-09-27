/**
 * @vitest-environment jsdom
 * The evaluator editor's Required to pass switch and its remove action.
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "p1" } }),
}));
vi.mock("@langwatch/trace-browser/surfaces/project-span-names", () => ({
  useProjectSpanNames: () => ({ spanNames: [], metadataKeys: [] }),
}));

const mockOpenDrawer = vi.hoisted(() => vi.fn());
const flowCallbacksStore = vi.hoisted(() => ({}) as Record<string, Record<string, unknown>>);
vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDrawer: () => ({ openDrawer: mockOpenDrawer }),
  setFlowCallbacks: (drawer: string, callbacks: Record<string, unknown>) => {
    flowCallbacksStore[drawer] = callbacks;
  },
  getFlowCallbacks: (drawer: string) => flowCallbacksStore[drawer],
}));

import {
  EvaluatorEditorBody,
  type EvaluatorEditorController,
  EvaluatorEditorFooter,
  type EvaluatorGateConfig,
  REQUIRED_TO_PASS_COPY,
  SCORE_ONLY_COPY,
} from "../evaluator-editor-shared.tsx";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
    availableSources: [
      {
        id: "conversation",
        name: "Conversation",
        type: "agent",
        fields: [{ name: "last_agent_message", label: "Last agent message", type: "str" }],
      },
    ],
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
function Harness({
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

describe("the evaluator editor gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(flowCallbacksStore)) {
      delete flowCallbacksStore[key];
    }
  });

  afterEach(cleanup);

  describe("given an evaluator that produces a pass or fail", () => {
    /** @scenario "The evaluator editor carries the Required to pass switch" */
    it("reads the Required to pass switch under the mappings and writes a flip back", async () => {
      const user = userEvent.setup();
      const onRequiredChange = vi.fn();
      render(
        <Harness
          gate={{ required: true, canRequire: true }}
          required={true}
          onRequiredChange={onRequiredChange}
        />,
        { wrapper: Wrapper },
      );

      const section = screen.getByTestId("evaluator-gate-section");
      expect(section).toHaveTextContent("Required to pass");
      expect(section).toHaveTextContent(REQUIRED_TO_PASS_COPY);
      const mappings = screen.getByTestId("mapping-input-output");
      // The gate reads after the inputs it gates on.
      expect(
        mappings.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const toggle = screen.getByTestId("evaluator-required-switch");
      expect(toggle).toBeChecked();
      expect(toggle).not.toBeDisabled();
      await user.click(toggle);
      expect(onRequiredChange).toHaveBeenCalledWith(false);
    });
  });

  describe("given a score only evaluator", () => {
    /** @scenario "A score only evaluator cannot be required" */
    it("holds the switch off and disabled, and says scores do not gate", () => {
      render(
        <Harness
          gate={{ required: false, canRequire: false }}
          required={false}
          onRequiredChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const section = screen.getByTestId("evaluator-gate-section");
      expect(section).toHaveTextContent(SCORE_ONLY_COPY);
      const toggle = screen.getByTestId("evaluator-required-switch");
      expect(toggle).not.toBeChecked();
      expect(toggle).toBeDisabled();
    });
  });

  describe("given the editor is opened without a gate", () => {
    /** @scenario "An evaluator editor without a gate offers no Required to pass switch" */
    it("shows no Required to pass section and no remove action", () => {
      render(<Harness gate={undefined} required={false} />, {
        wrapper: Wrapper,
      });

      expect(screen.queryByTestId("evaluator-gate-section")).not.toBeInTheDocument();
      expect(screen.queryByTestId("evaluator-remove-button")).not.toBeInTheDocument();
    });
  });

  describe("given an attachment can be taken off", () => {
    /** @scenario "The evaluator editor offers to remove the evaluator" */
    it("offers Remove evaluator in the footer", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      render(
        <Harness gate={{ required: true, canRequire: true }} required={true} onRemove={onRemove} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("evaluator-remove-button"));
      expect(onRemove).toHaveBeenCalled();
    });
  });
});
