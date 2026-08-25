/**
 * @vitest-environment jsdom
 *
 * Renders the real dataset picker used by the "Add to Dataset" drawer and the
 * automations trigger editor.
 *
 * The behaviour being pinned is what the picker says when it has nothing to
 * show. An empty dropdown renders identically whether the list is still
 * loading, genuinely empty, or failed to arrive - so a slow project looked
 * like a project with no datasets at all.
 *
 * Spec: specs/datasets/add-to-dataset-picker.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dataset } from "~/generated/prisma/client";
import { DatasetSelector } from "../DatasetSelector";

const buildDataset = ({ name, id }: { name: string; id: string }): Dataset =>
  ({
    id,
    name,
    slug: id,
    projectId: "test-project-id",
    columnTypes: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    archivedAt: null,
    mapping: null,
    useS3: false,
    s3RecordCount: null,
    contentLayout: "s3_jsonl",
    status: "ready",
    statusError: null,
    stagingKey: null,
    uploadFilename: null,
    rowCount: 10,
    sizeBytes: null,
    chunkCount: 1,
    chunkOffsets: null,
  }) as unknown as Dataset;

type SelectorProps = Parameters<typeof DatasetSelector>[0];

const selector = (props: Partial<SelectorProps> = {}) => (
  <ChakraProvider value={defaultSystem}>
    <DatasetSelector
      datasets={undefined}
      localStorageDatasetId=""
      errors={{}}
      setValue={vi.fn()}
      onCreateNew={vi.fn()}
      {...props}
    />
  </ChakraProvider>
);

const renderSelector = (props: Partial<SelectorProps> = {}) => render(selector(props));

afterEach(cleanup);

describe("DatasetSelector", () => {
  describe("given the project's datasets have not finished loading", () => {
    describe("when the picker renders", () => {
      /** @scenario "The dataset dropdown says it is loading" */
      it("announces that it is loading instead of showing an empty dropdown", () => {
        renderSelector({ datasets: undefined, isLoading: true });

        expect(
          screen.getByRole("status", { name: "Loading datasets" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Loading datasets...")).toBeInTheDocument();
        expect(screen.queryByText("Select Dataset")).not.toBeInTheDocument();
        expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
      });
    });

    describe("when the datasets then arrive", () => {
      /** @scenario "The datasets appear once they arrive" */
      it("swaps the loading state for a usable dropdown", () => {
        const { rerender } = renderSelector({
          datasets: undefined,
          isLoading: true,
        });

        expect(screen.getByRole("status")).toBeInTheDocument();

        rerender(
          selector({
            datasets: [buildDataset({ name: "offline evals", id: "dataset-1" })],
            isLoading: false,
          }),
        );

        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.queryByText("Loading datasets...")).toBeNull();
        expect(screen.getByText("Select Dataset")).toBeInTheDocument();
        expect(screen.getByRole("combobox")).not.toBeDisabled();
      });
    });
  });

  describe("given the project has no datasets", () => {
    describe("when the picker renders", () => {
      /** @scenario "A project with no datasets is told so, not left blank" */
      it("says there are none yet, and does not invite a click into nothing", () => {
        renderSelector({ datasets: [], isLoading: false });

        expect(screen.getByText("No datasets yet")).toBeInTheDocument();
        expect(screen.queryByText("Loading datasets...")).toBeNull();
        expect(screen.getByRole("combobox")).toBeDisabled();
      });
    });

    describe("when I choose to create one", () => {
      /** @scenario "I can still create a dataset from the drawer" */
      it("hands off to the creation flow", async () => {
        const user = userEvent.setup();
        const onCreateNew = vi.fn();
        renderSelector({ datasets: [], isLoading: false, onCreateNew });

        await user.click(screen.getByRole("button", { name: "+ Create New" }));

        expect(onCreateNew).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the request for the datasets failed", () => {
    describe("when the picker renders", () => {
      /** @scenario "A failed request is not reported as an empty project" */
      it("says they could not be loaded, not that there are none", () => {
        renderSelector({
          datasets: undefined,
          isLoading: false,
          isError: true,
        });

        expect(screen.getByText("Could not load datasets")).toBeInTheDocument();
        expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
        expect(screen.getByRole("combobox")).toBeDisabled();
      });

      /** @scenario "A failed request is not reported as an empty project" */
      it("does the same when the caller reports no failure but sends no list", () => {
        renderSelector({ datasets: undefined, isLoading: false });

        expect(screen.getByText("Could not load datasets")).toBeInTheDocument();
        expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
      });
    });
  });

  // Ark UI's Select does not mount its portaled options under jsdom, so a
  // dataset's presence in the dropdown is asserted through the value the
  // trigger resolves for it rather than by opening the list.
  describe("given the datasets have arrived", () => {
    describe("when one is already selected", () => {
      /** @scenario "The datasets appear once they arrive" */
      it("resolves that dataset's name from the list", () => {
        renderSelector({
          datasets: [buildDataset({ name: "offline evals", id: "dataset-1" })],
          isLoading: false,
          localStorageDatasetId: "dataset-1",
        });

        expect(screen.getByRole("combobox")).toHaveTextContent("offline evals");
      });
    });
  });
});
