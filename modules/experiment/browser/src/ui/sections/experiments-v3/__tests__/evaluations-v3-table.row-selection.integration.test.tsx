/**
 * The workbench's row checkboxes follow the row selection the toolbar counts.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import type { DatasetReference } from "../../../../model/experiments-v3/types.ts";
import { EvaluationsV3Table } from "../evaluations-v3-table.tsx";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("../../../../behavior/experiments-v3/use-latest-prompt-version.ts", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

vi.mock("../../../../behavior/experiments-v3/use-target-name.ts", () => {
  const useTargetName = (_target: { id: string }) => "wf agent";
  return {
    useTargetName,
    useTargetNames: (targets: ({ id: string } | undefined)[]) =>
      targets.map((target) => (target ? useTargetName(target) : "")),
  };
});
vi.mock("../../../../behavior/experiments-v3/use-evaluator-name.ts", () => ({
  useEvaluatorName: () => "Exact Match",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

vi.mock("../../../../behavior/experiment-api.ts", () => ({
  experimentApi: {
    useUtils: () => ({
      agents: { getById: { fetch: vi.fn() } },
      prompts: { getByIdOrHandle: { fetch: vi.fn().mockResolvedValue(null) } },
      evaluators: { getById: { fetch: vi.fn().mockResolvedValue(null) } },
    }),
    agents: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({
      agents: { getById: { fetch: vi.fn() } },
      prompts: { getByIdOrHandle: { fetch: vi.fn().mockResolvedValue(null) } },
      evaluators: { getById: { fetch: vi.fn().mockResolvedValue(null) } },
    }),
    datasetRecord: {
      getAll: { useQuery: () => ({ data: null, isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMany: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
    useUtils: () => ({
      agents: { getById: { fetch: vi.fn() } },
      prompts: { getByIdOrHandle: { fetch: vi.fn().mockResolvedValue(null) } },
      evaluators: { getById: { fetch: vi.fn().mockResolvedValue(null) } },
    }),
    evaluators: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

vi.mock("@langwatch/prompt-client", () => ({
  PromptEditorDrawerToken: { id: "promptEditor" },
  promptClient: {
    useUtils: () => ({
      agents: { getById: { fetch: vi.fn() } },
      prompts: { getByIdOrHandle: { fetch: vi.fn().mockResolvedValue(null) } },
      evaluators: { getById: { fetch: vi.fn().mockResolvedValue(null) } },
    }),
    prompts: {
      getAllPromptsForProject: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
  },
}));

vi.mock("../../../../behavior/experiments-v3/lent-dataset-capabilities.tsx", () => ({
  AddOrEditDatasetDrawer: () => null,
  DatasetRecordSync: () => null,
}));

const columns = [
  { id: "question", name: "question", type: "string" as const },
  { id: "expected_output", name: "expected_output", type: "string" as const },
];

const dataset = (): DatasetReference => ({
  id: "test-data",
  name: "Test Data",
  type: "inline",
  columns,
  inline: {
    columns,
    records: {
      question: ["is a dog an animal?", "is a cat an animal?"],
      expected_output: ["yes", "yes"],
    },
  },
});

const rowCheckboxes = () => screen.getAllByRole<HTMLInputElement>("checkbox").slice(1, 3);

describe("Workbench row selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.setState({
      datasets: [dataset()],
      activeDatasetId: "test-data",
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a workbench with two dataset rows", () => {
    describe("when a row is selected", () => {
      /** @scenario "A selected row shows its checkbox ticked" */
      it("ticks that row's checkbox and counts one selected", () => {
        renderWithDesignSystem(<EvaluationsV3Table disableVirtualization />);

        act(() => useEvaluationsV3Store.getState().toggleRowSelection(0));

        expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
        expect(rowCheckboxes().map((box) => box.checked)).toEqual([true, false]);
      });

      /** @scenario "A selected row shows its checkbox ticked" */
      it("marks the header checkbox as partly selected", () => {
        renderWithDesignSystem(<EvaluationsV3Table disableVirtualization />);

        act(() => useEvaluationsV3Store.getState().toggleRowSelection(0));

        expect(screen.getAllByRole("checkbox")[0]!.closest("label")).toHaveAttribute(
          "data-state",
          "indeterminate",
        );
      });

      /** @scenario "A selected row shows its checkbox ticked" */
      it("ticks the checkbox when it is clicked", async () => {
        const user = userEvent.setup();
        renderWithDesignSystem(<EvaluationsV3Table disableVirtualization />);

        await user.click(rowCheckboxes()[1]!);

        expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
        expect(rowCheckboxes().map((box) => box.checked)).toEqual([false, true]);
      });
    });

    describe("when the header checkbox selects every row", () => {
      /** @scenario "Selecting every row ticks the header and every row" */
      it("ticks every row and the header", async () => {
        const user = userEvent.setup();
        renderWithDesignSystem(<EvaluationsV3Table disableVirtualization />);

        await user.click(screen.getAllByRole("checkbox")[0]!);

        expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");
        expect(screen.getAllByRole<HTMLInputElement>("checkbox").map((box) => box.checked)).toEqual(
          [true, true, true, false],
        );
      });
    });

    describe("when the selection is cleared from the toolbar", () => {
      /** @scenario "Clearing the selection unticks every checkbox" */
      it("unticks the row checkboxes", async () => {
        const user = userEvent.setup();
        renderWithDesignSystem(<EvaluationsV3Table disableVirtualization />);
        act(() => useEvaluationsV3Store.getState().toggleRowSelection(0));
        expect(rowCheckboxes()[0]!.checked).toBe(true);

        await user.click(screen.getByTestId("selection-clear-btn"));

        expect(screen.queryByTestId("selection-count")).toBeNull();
        expect(rowCheckboxes().map((box) => box.checked)).toEqual([false, false]);
      });
    });
  });
});
