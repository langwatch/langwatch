/**
 * @vitest-environment jsdom
 *
 * The evaluator editor's Required to pass switch and its remove action.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { cleanup, render, screen } from "@testing-library/react";
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
  REQUIRED_TO_PASS_COPY,
  SCORE_ONLY_COPY,
} from "~/components/evaluators/EvaluatorEditorShared";
import { Harness, Wrapper } from "./scenarioEvaluatorEditorHarness";

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
});
