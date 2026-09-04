/**
 * @vitest-environment jsdom
 *
 * The evaluator editor as the suite editor and the run dialog open it: the
 * three scenario sources for the mappings, the Required to pass switch under
 * them, and the way to take the attachment off.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "p1" } }),
}));
vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({ spanNames: [], metadataKeys: [] }),
}));

const mockOpenDrawer = vi.hoisted(() => vi.fn());
const flowCallbacksStore = vi.hoisted(
  () => ({}) as Record<string, Record<string, unknown>>,
);
vi.mock("~/hooks/useDrawer", () => ({
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
} from "~/components/evaluators/EvaluatorEditorShared";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import { scenarioMappingSources } from "~/server/scenarios/evaluator-attachments";
import type { AttachableEvaluator } from "../evaluators/attachment-rules";
import { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const SUITE_FIELDS = [
  { identifier: "golden_sql", type: "text" as const },
  { identifier: "table_schema", type: "text" as const },
];

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
  const form = useForm({
    defaultValues: { name: "SQL Equivalence", settings: {} },
  });
  const controller = {
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

  return (
    <>
      <EvaluatorEditorBody controller={controller} />
      <EvaluatorEditorFooter controller={controller} />
    </>
  );
}

const ATTACHMENT: EvaluatorAttachment = {
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

const SQL_EVALUATOR: AttachableEvaluator = {
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
function OpenEditor({
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

describe("the evaluator editor on a scenario attachment", () => {
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
        mappings.compareDocumentPosition(section) &
          Node.DOCUMENT_POSITION_FOLLOWING,
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
    it("shows no Required to pass section and no remove action", () => {
      render(<Harness gate={undefined} required={false} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.queryByTestId("evaluator-gate-section"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("evaluator-remove-button"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given an attachment can be taken off", () => {
    /** @scenario "The evaluator editor offers to remove the evaluator" */
    it("offers Remove evaluator in the footer", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      render(
        <Harness
          gate={{ required: true, canRequire: true }}
          required={true}
          onRemove={onRemove}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("evaluator-remove-button"));
      expect(onRemove).toHaveBeenCalled();
    });
  });

  describe("when the editor is opened on an attachment", () => {
    /** @scenario "The evaluator editor offers the conversation, the scenario and the trace as sources" */
    it("lists Conversation, Scenario and Trace, and the suite fields under Scenario", async () => {
      const user = userEvent.setup();
      render(
        <Harness gate={{ required: true, canRequire: true }} required={true} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("mapping-input-expected_output"));
      await waitFor(() =>
        expect(screen.getByText("Conversation")).toBeInTheDocument(),
      );
      expect(screen.getByText("Scenario")).toBeInTheDocument();
      expect(screen.getByText("Trace")).toBeInTheDocument();
    });

    /** @scenario "A mapping edited in the editor lands on the attachment" */
    it("opens the drawer with the scenario sources and writes a picked mapping back", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      const onRequiredChange = vi.fn();
      const onRemove = vi.fn();
      render(
        <OpenEditor
          evaluator={SQL_EVALUATOR}
          onMappingChange={onMappingChange}
          onRequiredChange={onRequiredChange}
          onRemove={onRemove}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: "Open" }));

      const [drawer, props] = mockOpenDrawer.mock.calls[0]!;
      expect(drawer).toBe("evaluatorEditor");
      expect(props).toEqual({
        evaluatorId: "eval_sql",
        evaluatorType: "ragas/sql_query_equivalence",
        mappingsConfig: {
          availableSources: expect.arrayContaining([
            expect.objectContaining({ id: "conversation" }),
            expect.objectContaining({ id: "scenario" }),
            expect.objectContaining({ id: "trace" }),
          ]),
          initialMappings: ATTACHMENT.mappings,
        },
        gate: { required: true, canRequire: true },
      });

      // The drawer reads its callbacks by name; a picked source lands on the
      // attachment in the run's own mapping shape.
      const callbacks = flowCallbacksStore.evaluatorEditor!;
      (callbacks.onMappingChange as (input: string, mapping: unknown) => void)(
        "expected_output",
        {
          type: "source",
          sourceId: "scenario",
          path: ["fields", "golden_sql"],
        },
      );
      expect(onMappingChange).toHaveBeenCalledWith("expected_output", {
        type: "source",
        sourceId: "scenario",
        path: ["fields", "golden_sql"],
      });
      (callbacks.onRequiredChange as (required: boolean) => void)(false);
      expect(onRequiredChange).toHaveBeenCalledWith(false);
      (callbacks.onRemove as () => void)();
      expect(onRemove).toHaveBeenCalled();
    });

    it("routes a code evaluator to its own editor with the same sources", async () => {
      const user = userEvent.setup();
      render(
        <OpenEditor
          evaluator={{ ...SQL_EVALUATOR, type: "code" }}
          onMappingChange={vi.fn()}
          onRequiredChange={vi.fn()}
          onRemove={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: "Open" }));

      const [drawer, props] = mockOpenDrawer.mock.calls[0]!;
      expect(drawer).toBe("codeEvaluatorEditor");
      expect(props).toEqual({
        evaluatorId: "eval_sql",
        mappingsConfig: expect.objectContaining({
          initialMappings: ATTACHMENT.mappings,
        }),
      });
      expect(flowCallbacksStore.codeEvaluatorEditor?.onMappingChange).toEqual(
        expect.any(Function),
      );
    });
  });
});
