/**
 * @vitest-environment jsdom
 * The evaluator editor's source picker over a scenario attachment's sources: the conversation,
 * the scenario with its suite fields, and the trace.
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { scenarioMappingSources } from "@langwatch/scenario-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "p1" } }),
}));
vi.mock("../../../../behavior/use-project-span-names.ts", () => ({
  useProjectSpanNames: () => ({ spanNames: [], metadataKeys: [] }),
}));

import {
  EvaluatorEditorBody,
  type EvaluatorEditorController,
  EvaluatorEditorFooter,
  type EvaluatorGateConfig,
} from "../evaluator-editor-shared.tsx";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const SUITE_FIELDS = [
  { identifier: "golden_sql", type: "text" as const },
  { identifier: "table_schema", type: "text" as const },
];

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

describe("the evaluator editor on a scenario attachment", () => {
  afterEach(cleanup);

  describe("given an evaluator attachment", () => {
    describe("when the source picker is opened", () => {
      /** @scenario "The evaluator editor offers the conversation, the scenario and the trace as sources" */
      it("lists Conversation, Scenario and Trace, and the suite fields under Scenario", async () => {
        const user = userEvent.setup();
        render(<Harness gate={{ required: true, canRequire: true }} required={true} />, {
          wrapper: Wrapper,
        });

        await user.click(screen.getByTestId("mapping-input-expected_output"));
        await waitFor(() => expect(screen.getByText("Conversation")).toBeInTheDocument());
        expect(screen.getByText("Scenario")).toBeInTheDocument();
        expect(screen.getByText("Trace")).toBeInTheDocument();

        // The suite fields are nested under Scenario's "Fields" entry, so they
        // only render once that entry is expanded.
        await user.click(screen.getByTestId("field-option-fields"));
        await waitFor(() => expect(screen.getByText("golden_sql")).toBeInTheDocument());
        expect(screen.getByText("table_schema")).toBeInTheDocument();
      });
    });

    describe("when the spans of the trace are picked for an input", () => {
      /** @scenario "A Trace.spans mapping renders as spans" */
      it("writes a trace.spans mapping and renders its chip as spans", async () => {
        const user = userEvent.setup();
        const onMappingChange = vi.fn();
        render(
          <Harness
            gate={{ required: true, canRequire: true }}
            required={true}
            onMappingChange={onMappingChange}
          />,
          { wrapper: Wrapper },
        );

        await user.click(screen.getByTestId("mapping-input-expected_output"));
        await waitFor(() => expect(screen.getByText("Trace")).toBeInTheDocument());
        await user.click(screen.getByTestId("field-option-spans"));

        expect(onMappingChange).toHaveBeenCalledWith("expected_output", {
          type: "source",
          sourceId: "trace",
          path: ["spans"],
        });
        const chips = screen.getAllByTestId("source-mapping-tag");
        expect(chips.map((chip) => chip.textContent)).toContain("spans");
      });
    });
  });
});
