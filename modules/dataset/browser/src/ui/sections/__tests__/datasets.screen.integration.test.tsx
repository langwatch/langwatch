/**
 * @vitest-environment jsdom
 * Datasets list screen (listing, search, navigation, states). Entry counts
 * are a second read, mocked apart from the list.
 */

import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import type { DatasetSummary } from "@langwatch/dataset-contract";
import { SetupWithAgentButtonToken } from "@langwatch/trace-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithDatasetHost } from "../../../testing.tsx";

const { countsQuery, datasetsQuery, mockDeleteMutate } = vi.hoisted(() => ({
  countsQuery: {
    current: { data: undefined } as {
      data: { datasetId: string; recordCount: number }[] | undefined;
      isError?: boolean;
    },
    asked: [] as { input: unknown; options: unknown }[],
  },
  datasetsQuery: {
    current: { data: undefined, isLoading: false, refetch: vi.fn() } as {
      data: unknown;
      isLoading: boolean;
      isError?: boolean;
      refetch: () => void;
    },
  },
  mockDeleteMutate: vi.fn(),
}));

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => {
  const { uiDeclarations: none } = await import("@langwatch/browser-host/declarations");
  const nothingLent = none([]);
  return {
    ...(await importOriginal<object>()),
    useUiDeclarations: () => declarations.current ?? nothingLent,
  };
});

vi.mock("../../../behavior/dataset-api.ts", () => ({
  datasetApi: {
    useUtils: () => ({
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    dataset: {
      getAll: { useQuery: () => datasetsQuery.current },
      recordCounts: {
        useQuery: (input: unknown, options: unknown) => {
          countsQuery.asked.push({ input, options });
          return countsQuery.current;
        },
      },
      deleteById: { useMutation: () => ({ mutate: mockDeleteMutate, isPending: false }) },
    },
  },
}));

// The three overlays have their own suites; here they only have to be absent
// until the screen opens them.
vi.mock("../../../ui/sections/add-or-edit-dataset-drawer.tsx", () => ({
  AddOrEditDatasetDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-edit-dataset-drawer" /> : null,
}));
vi.mock("../../../ui/sections/bulk-upload-drawer.tsx", () => ({
  BulkUploadDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="bulk-upload-drawer" /> : null,
}));
vi.mock("../../../ui/sections/copy-dataset-dialog.tsx", () => ({
  CopyDatasetDialog: () => <div data-testid="copy-dataset-dialog" />,
}));

const { default: DatasetsScreen } = await import("../datasets.screen.tsx");

const makeDataset = (id: string, name: string): DatasetSummary => ({
  id,
  name,
  slug: id,
  columnTypes: [
    { name: "input", type: "string" },
    { name: "expected_output", type: "string" },
  ],
  createdAt: new Date("2026-01-01T10:00:00Z"),
  updatedAt: new Date("2026-02-02T10:00:00Z"),
  status: "ready",
});

describe("Datasets list screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countsQuery.asked = [];
    countsQuery.current = {
      data: [
        { datasetId: "ds-1", recordCount: 12 },
        { datasetId: "ds-2", recordCount: 3 },
      ],
    };
    datasetsQuery.current = {
      data: [makeDataset("ds-1", "offline evals"), makeDataset("ds-2", "production samples")],
      isLoading: false,
      refetch: vi.fn(),
    };
  });

  describe("given the project has datasets", () => {
    /** @scenario Datasets are listed with their key facts */
    it("lists each dataset with name, columns, entry count, and last update", () => {
      renderWithDatasetHost(<DatasetsScreen />);

      expect(screen.getByText("offline evals")).toBeInTheDocument();
      expect(screen.getByText("production samples")).toBeInTheDocument();
      expect(screen.getAllByText("input")).toHaveLength(2);
      expect(screen.getAllByText("expected_output")).toHaveLength(2);
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      // Last update uses updatedAt, not createdAt.
      expect(screen.getAllByText(/Feb/)).toHaveLength(2);
      expect(screen.queryByText(/Jan/)).not.toBeInTheDocument();
    });

    describe("given the entry counts are still being counted", () => {
      /** @scenario "The list shows before entry counts arrive" */
      it("shows every row at once, with a muted placeholder for each count", () => {
        countsQuery.current = { data: undefined };
        renderWithDatasetHost(<DatasetsScreen />);

        expect(screen.getByText("offline evals")).toBeInTheDocument();
        expect(screen.getByText("production samples")).toBeInTheDocument();
        expect(screen.getAllByLabelText("Counting entries")).toHaveLength(2);
      });
    });

    describe("given reading the entry counts failed", () => {
      /** @scenario "A failed entry count read shows the counts as unavailable" */
      it("shows each count as unavailable instead of loading", () => {
        countsQuery.current = { data: undefined, isError: true };
        renderWithDatasetHost(<DatasetsScreen />);

        expect(screen.getByText("offline evals")).toBeInTheDocument();
        expect(screen.getAllByLabelText("Entry count unavailable")).toHaveLength(2);
        expect(screen.queryByLabelText("Counting entries")).not.toBeInTheDocument();
      });
    });

    describe("when their entry counts arrive", () => {
      /** @scenario "Entry counts arrive after the list" */
      it("asks for the listed datasets' counts and shows each one in its row", () => {
        renderWithDatasetHost(<DatasetsScreen />);

        expect(countsQuery.asked.at(-1)).toMatchObject({
          input: { datasetIds: ["ds-1", "ds-2"] },
          options: { enabled: true },
        });
        expect(within(screen.getByTestId("dataset-row-ds-1")).getByText("12")).toBeInTheDocument();
        expect(within(screen.getByTestId("dataset-row-ds-2")).getByText("3")).toBeInTheDocument();
        expect(screen.queryByLabelText("Counting entries")).not.toBeInTheDocument();
      });
    });

    describe("when the reader searches", () => {
      /** @scenario Search datasets by name */
      it("filters the list as they type", async () => {
        const user = userEvent.setup();
        renderWithDatasetHost(<DatasetsScreen />);

        await user.type(screen.getByTestId("datasets-search"), "offline");

        await waitFor(() =>
          expect(screen.queryByText("production samples")).not.toBeInTheDocument(),
        );
        expect(screen.getByText("offline evals")).toBeInTheDocument();
      });

      it("shows a no-results hint when the search matches nothing, and clears it", async () => {
        const user = userEvent.setup();
        renderWithDatasetHost(<DatasetsScreen />);

        await user.type(screen.getByTestId("datasets-search"), "zzz");

        expect(await screen.findByText(/No datasets match "zzz"/i)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /clear filters/i }));

        expect(await screen.findByText("offline evals")).toBeInTheDocument();
        expect(screen.getByTestId("datasets-search")).toHaveValue("");
      });
    });

    describe("when a dataset's name is chosen with the keyboard", () => {
      it("opens it from the name, which is a real link", async () => {
        const user = userEvent.setup();
        const { host } = renderWithDatasetHost(<DatasetsScreen />);

        const link = screen.getByRole("link", { name: "offline evals" });
        expect(link).toHaveAttribute("href", "/test-project/datasets/ds-1");
        link.focus();
        await user.keyboard("{Enter}");

        expect(host.navigations).toEqual(["/test-project/datasets/ds-1"]);
      });
    });

    describe("when a row is clicked", () => {
      /** @scenario Open a dataset */
      it("navigates to that dataset's editor", async () => {
        const user = userEvent.setup();
        const { host } = renderWithDatasetHost(<DatasetsScreen />);

        await user.click(screen.getByText("offline evals"));

        expect(host.navigations).toEqual(["/test-project/datasets/ds-1"]);
      });
    });
  });

  describe("given the datasets are still being fetched", () => {
    beforeEach(() => {
      datasetsQuery.current = { data: undefined, isLoading: true, refetch: vi.fn() };
    });

    /** @scenario "The list loads while I wait, and tells me it is loading" */
    it("shows loading placeholders instead of the empty-project message", () => {
      const { container } = renderWithDatasetHost(<DatasetsScreen />);

      expect(container.querySelectorAll("[class*='chakra-skeleton']").length).toBeGreaterThan(0);
      expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
      expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
      // The header action stays, so the reader can start a dataset while the list loads.
      expect(screen.getByTestId("upload-or-create-dataset")).toBeInTheDocument();
    });
  });

  describe("given the datasets could not be loaded", () => {
    it("explains the failure with a retry and a next step", async () => {
      const refetch = vi.fn();
      datasetsQuery.current = { data: undefined, isLoading: false, isError: true, refetch };
      const user = userEvent.setup();
      renderWithDatasetHost(<DatasetsScreen />);

      expect(screen.getByText("Couldn't load the datasets")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /read about datasets/i })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /try again/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the datasets loaded", () => {
    /** @scenario The datasets list shows no error when the read succeeded */
    it("shows the rows with no error notice", () => {
      datasetsQuery.current = {
        data: [makeDataset("ds-1", "offline evals")],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
      renderWithDatasetHost(<DatasetsScreen />);

      expect(screen.getByText("offline evals")).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load the datasets")).not.toBeInTheDocument();
    });
  });

  describe("given a refresh fails after the datasets loaded", () => {
    /** @scenario A failed refresh keeps the datasets I already see */
    it("keeps the rows with the error as a notice over them", () => {
      datasetsQuery.current = {
        data: [makeDataset("ds-1", "offline evals")],
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      };
      renderWithDatasetHost(<DatasetsScreen />);

      expect(screen.getByText("offline evals")).toBeInTheDocument();
      expect(screen.getByText("Couldn't load the datasets")).toBeInTheDocument();
    });
  });

  describe("given the project has no datasets", () => {
    beforeEach(() => {
      datasetsQuery.current = { data: [], isLoading: false, refetch: vi.fn() };
    });

    /** @scenario Every empty surface offers its own skill */
    it("offers trace's set-up-with-AI control for datasets", async () => {
      declarations.current = uiDeclarations([
        {
          name: "trace",
          installation: {
            capabilities: {},
            lends: [
              {
                token: SetupWithAgentButtonToken,
                load: async () => ({
                  default: ({ surface }: { surface: string }) => (
                    <button>Setup via Agent ({surface})</button>
                  ),
                }),
              },
            ],
          },
        },
      ]);
      renderWithDatasetHost(<DatasetsScreen />);

      expect(
        await screen.findByRole("button", { name: "Setup via Agent (datasets)" }),
      ).toBeInTheDocument();
      declarations.current = undefined;
    });

    /** @scenario Empty project shows a helpful empty state */
    it("shows the empty state, with upload-or-create in the header", async () => {
      const user = userEvent.setup();
      renderWithDatasetHost(<DatasetsScreen />);

      expect(screen.getByText("No datasets yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /read about datasets/i })).toHaveAttribute(
        "href",
        "https://docs.langwatch.ai/datasets/overview",
      );
      await user.click(screen.getByTestId("upload-or-create-dataset"));
      // The CTA is a dropdown: "Create empty dataset" opens the create drawer.
      await user.click(await screen.findByText("Create empty dataset"));
      expect(await screen.findByTestId("add-edit-dataset-drawer")).toBeInTheDocument();
    });

    /** @scenario Empty-state CTA can launch the bulk upload flow */
    it("opens the bulk upload drawer from the header action", async () => {
      const user = userEvent.setup();
      renderWithDatasetHost(<DatasetsScreen />);

      await user.click(screen.getByTestId("upload-or-create-dataset"));
      await user.click(await screen.findByText("Upload datasets"));
      expect(await screen.findByTestId("bulk-upload-drawer")).toBeInTheDocument();
    });
  });
});
