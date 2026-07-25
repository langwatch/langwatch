/**
 * @vitest-environment jsdom
 *
 * Observable-outcome regression for issue #950 ("cannot map fields on the
 * evaluation wizard"). The callback-plumbing checks in
 * EvaluatorMappings.integration.test.tsx assert that RunEvaluationButton wires
 * onMappingChange through setFlowCallbacks; this file closes the loop by
 * rendering the REAL evaluator-editor body and observing the RENDERED result:
 * the field-mapping controls appear only when onMappingChange is present, and
 * interacting with them drives the mapping callback (the store update).
 *
 * Exercises the real EvaluatorEditorBody -> EvaluatorMappingsSection ->
 * VariablesSection -> VariableMappingInput stack — nothing about the mapping UI
 * is mocked. A revert of the fix (onMappingChange back inside mappingsConfig, so
 * the drawer's flowCallbacks-sourced onMappingChange is undefined) makes the
 * "renders the controls" case fail here.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

// Avoid the optimization_studio circular-dep pulled in transitively by the
// evaluator-editor module graph (mirrors EvaluatorMappings.integration.test).
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

// The mapping section fetches project span names / metadata keys; stub those
// project-scoped hooks so the real UI renders without a backend.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "p1" } }),
}));
vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({ spanNames: [], metadataKeys: [] }),
}));

import {
  EvaluatorEditorBody,
  type EvaluatorEditorController,
} from "~/components/evaluators/EvaluatorEditorShared";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Renders the real drawer body with a real RHF form. Only the fields
// EvaluatorEditorBody reads are populated; the rest are inert.
function Harness({
  onMappingChange,
}: {
  onMappingChange:
    | ((identifier: string, mapping: unknown) => void)
    | undefined;
}) {
  const form = useForm({ defaultValues: { name: "My Eval", settings: {} } });
  const controller = {
    form,
    evaluatorId: undefined,
    evaluatorType: "langevals/exact_match",
    evaluatorDef: undefined,
    effectiveEvaluatorDef: {
      requiredFields: ["contexts", "output"],
      optionalFields: [],
    },
    isLoadingEvaluator: false,
    workflowCard: undefined,
    isWorkflowEvaluator: false,
    hasSettings: false,
    settingsSchema: undefined,
    projectSlug: "p1",
    mappingsConfig: {
      availableSources: [
        {
          id: "ds",
          name: "Test Data",
          type: "dataset" as const,
          fields: [{ name: "input", type: "str" as const }],
        },
      ],
      initialMappings: {},
    },
    onMappingChange,
    comparisonContext: undefined,
    comparison: {
      variants: [],
      hasGoldenAnswer: true,
      goldenField: "",
      includeMetrics: [],
      randomizeOrder: true,
    },
    onComparisonChange: undefined,
  } as unknown as EvaluatorEditorController;

  return <EvaluatorEditorBody controller={controller} />;
}

describe("Evaluator editor body — field-mapping render (issue #950)", () => {
  afterEach(cleanup);

  describe("when onMappingChange is wired (the fixed Run path)", () => {
    it("renders a field-mapping control for each required field", () => {
      render(<Harness onMappingChange={vi.fn()} />, { wrapper: Wrapper });

      // The mapping picker for each required evaluator field is on screen.
      expect(screen.getByTestId("mapping-input-contexts")).toBeInTheDocument();
      expect(screen.getByTestId("mapping-input-output")).toBeInTheDocument();
    });

    it("drives the mapping callback when a source is picked (store update)", async () => {
      const onMappingChange = vi.fn();
      const user = userEvent.setup();
      render(<Harness onMappingChange={onMappingChange} />, { wrapper: Wrapper });

      // Open the picker for "contexts" and choose the dataset's "input" column.
      await user.click(screen.getByTestId("mapping-input-contexts"));
      await waitFor(() =>
        expect(screen.getByTestId("field-option-input")).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId("field-option-input"));

      // The evaluator-editor's mapping sink (which persists to the store) fired.
      await waitFor(() =>
        expect(onMappingChange).toHaveBeenCalledWith(
          "contexts",
          expect.objectContaining({ type: "source" }),
        ),
      );
    });
  });

  describe("when onMappingChange is absent (the pre-fix Run path)", () => {
    it("does not render any field-mapping control", () => {
      render(<Harness onMappingChange={undefined} />, { wrapper: Wrapper });

      // This is the #950 symptom: the drawer opens but there is nothing to map.
      expect(
        screen.queryByTestId("mapping-input-contexts"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("mapping-input-output"),
      ).not.toBeInTheDocument();
    });
  });
});
