/**
 * @vitest-environment jsdom
 *
 * The evaluator editor's mapping sources: the three scenario sources, the
 * suite fields listed under Scenario, and the routing to a code evaluator's
 * own editor.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  ATTACHMENT,
  Harness,
  OpenEditor,
  SQL_EVALUATOR,
  Wrapper,
} from "./scenarioEvaluatorEditorHarness";

describe("the evaluator editor on an attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(flowCallbacksStore)) {
      delete flowCallbacksStore[key];
    }
  });

  afterEach(cleanup);

  describe("given an evaluator attachment", () => {
    describe("when the source picker is opened", () => {
      /** @scenario "The evaluator editor offers the conversation, the scenario and the trace as sources" */
      it("lists Conversation, Scenario and Trace, and the suite fields under Scenario", async () => {
        const user = userEvent.setup();
        render(
          <Harness
            gate={{ required: true, canRequire: true }}
            required={true}
          />,
          { wrapper: Wrapper },
        );

        await user.click(screen.getByTestId("mapping-input-expected_output"));
        await waitFor(() =>
          expect(screen.getByText("Conversation")).toBeInTheDocument(),
        );
        expect(screen.getByText("Scenario")).toBeInTheDocument();
        expect(screen.getByText("Trace")).toBeInTheDocument();

        // The suite fields are nested under Scenario's "Fields" entry, so they
        // only render once that entry is expanded.
        await user.click(screen.getByTestId("field-option-fields"));
        await waitFor(() =>
          expect(screen.getByText("golden_sql")).toBeInTheDocument(),
        );
        expect(screen.getByText("table_schema")).toBeInTheDocument();
      });
    });

    describe("when the editor is opened from a pill", () => {
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
        (
          callbacks.onMappingChange as (input: string, mapping: unknown) => void
        )("expected_output", {
          type: "source",
          sourceId: "scenario",
          path: ["fields", "golden_sql"],
        });
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

      describe("when the evaluator is a code evaluator", () => {
        /** @scenario "A code evaluator attachment opens its own editor with the same mapping sources" */
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
            gate: { required: ATTACHMENT.required, canRequire: true },
          });
          expect(
            flowCallbacksStore.codeEvaluatorEditor?.onMappingChange,
          ).toEqual(expect.any(Function));
        });

        /** @scenario "A code evaluator's own editor carries the gate switch and the remove action" */
        it("carries the gate switch and the remove action to a code evaluator's own editor", async () => {
          const user = userEvent.setup();
          const onRequiredChange = vi.fn();
          const onRemove = vi.fn();
          render(
            <OpenEditor
              evaluator={{ ...SQL_EVALUATOR, type: "code" }}
              onMappingChange={vi.fn()}
              onRequiredChange={onRequiredChange}
              onRemove={onRemove}
            />,
            { wrapper: Wrapper },
          );

          await user.click(screen.getByRole("button", { name: "Open" }));

          const callbacks = flowCallbacksStore.codeEvaluatorEditor!;
          (callbacks.onRequiredChange as (required: boolean) => void)(false);
          expect(onRequiredChange).toHaveBeenCalledWith(false);
          (callbacks.onRemove as () => void)();
          expect(onRemove).toHaveBeenCalled();
        });
      });
    });
  });
});
