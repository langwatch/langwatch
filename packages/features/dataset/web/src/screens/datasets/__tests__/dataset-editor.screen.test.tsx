/**
 * @vitest-environment jsdom
 *
 * The dataset detail screen's read gate and its chrome.
 *
 * Moved with the screen from
 * `platform/app/src/pages/[project]/datasets/__tests__/dataset-edit-run-experiment.integration.test.tsx`,
 * and widened: the platform suite covered only the Run experiment hand-off, and
 * the I-READY gate the page exists to enforce (ADR-032) was unbound.
 *
 * Spec: specs/datasets/dataset-editor.feature.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithDatasetHost } from "../../../testing";

const { datasetQuery } = vi.hoisted(() => ({
  datasetQuery: {
    current: {
      data: undefined as unknown,
      isSuccess: false,
      isLoading: false,
      refetch: vi.fn(),
    },
  },
}));

vi.mock("../../../behavior/dataset-api", () => ({
  datasetApi: {
    dataset: { getById: { useQuery: () => datasetQuery.current } },
  },
}));

// Render only the chrome (headerActions): the grid has its own suites, and
// mounting it here would drag the whole editor into a test about the gate.
vi.mock("../../../ui/sections/dataset-editor-table", () => ({
  DatasetEditorTable: ({ headerActions }: { headerActions?: ReactNode }) => (
    <div data-testid="dataset-editor-table">{headerActions}</div>
  ),
}));

const { default: DatasetEditorScreen } = await import("../dataset-editor.screen");

const ROUTE = { params: { id: "ds-1" }, query: {} };

describe("Dataset editor screen", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a ready dataset", () => {
    beforeEach(() => {
      datasetQuery.current = {
        data: { status: "ready" },
        isSuccess: true,
        isLoading: false,
        refetch: vi.fn(),
      };
    });

    describe("when the reader may run experiments", () => {
      /** @scenario Run an experiment from a dataset */
      it("navigates to a new experiment workbench seeded with the dataset", async () => {
        const user = userEvent.setup();
        const { host } = renderWithDatasetHost(<DatasetEditorScreen />, { route: ROUTE });

        await user.click(screen.getByTestId("run-experiment-from-dataset"));

        expect(host.navigations).toEqual(["/test-project/experiments/workbench?datasetId=ds-1"]);
      });
    });

    describe("when the reader may not run experiments", () => {
      it("mounts the editor without the experiment action", () => {
        renderWithDatasetHost(<DatasetEditorScreen />, {
          route: ROUTE,
          permissions: ["datasets:view"],
        });

        expect(screen.getByTestId("dataset-editor-table")).toBeInTheDocument();
        expect(screen.queryByTestId("run-experiment-from-dataset")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a dataset that is still preparing", () => {
    beforeEach(() => {
      datasetQuery.current = {
        data: { status: "processing" },
        isSuccess: true,
        isLoading: false,
        refetch: vi.fn(),
      };
    });

    it("says so and never mounts the editor", () => {
      renderWithDatasetHost(<DatasetEditorScreen />, { route: ROUTE });

      expect(screen.getByText(/Preparing your dataset/i)).toBeInTheDocument();
      expect(screen.queryByTestId("dataset-editor-table")).not.toBeInTheDocument();
    });
  });

  describe("given the dataset read has not settled", () => {
    beforeEach(() => {
      datasetQuery.current = {
        data: undefined,
        isSuccess: false,
        isLoading: true,
        refetch: vi.fn(),
      };
    });

    /**
     * The gate's whole point: before the query resolves the status is
     * `undefined`, and `undefined == null` is `true`. Mounting the editor on
     * that would read records from a dataset that may still be processing.
     */
    /** @scenario "The editor waits for the dataset's status before it reads any records" */
    it("holds the editor back rather than reading a dataset of unknown status", () => {
      renderWithDatasetHost(<DatasetEditorScreen />, { route: ROUTE });

      expect(screen.queryByTestId("dataset-editor-table")).not.toBeInTheDocument();
      expect(screen.getByText(/appear here once it is ready/i)).toBeInTheDocument();
    });
  });

  describe("given the dataset is gone", () => {
    beforeEach(() => {
      datasetQuery.current = {
        data: null,
        isSuccess: true,
        isLoading: false,
        refetch: vi.fn(),
      };
    });

    it("says it is no longer available rather than mounting an empty editor", () => {
      renderWithDatasetHost(<DatasetEditorScreen />, { route: ROUTE });

      expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
      expect(screen.queryByTestId("dataset-editor-table")).not.toBeInTheDocument();
    });
  });

  describe("given the dataset failed to prepare", () => {
    beforeEach(() => {
      datasetQuery.current = {
        data: { status: "failed", statusError: "bad header row" },
        isSuccess: true,
        isLoading: false,
        refetch: vi.fn(),
      };
    });

    /** @scenario "A dataset that failed to prepare names the reason and offers a retry" */
    it("names the reason and offers a retry", () => {
      renderWithDatasetHost(<DatasetEditorScreen />, { route: ROUTE });

      expect(screen.getByText("bad header row")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      expect(screen.queryByTestId("dataset-editor-table")).not.toBeInTheDocument();
    });
  });
});
