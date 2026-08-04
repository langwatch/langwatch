/**
 * @vitest-environment jsdom
 *
 * Renders the real dataset picker used by the "Add to Dataset" drawer and the
 * automations trigger editor.
 *
 * The behaviour being pinned is the difference between "still loading" and
 * "nothing here". An empty dropdown renders identically in both cases, so a
 * slow project looked like a project with no datasets at all.
 *
 * Spec: specs/datasets/add-to-dataset-picker.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { Dataset } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetSelector } from "../DatasetSelector";

const buildDataset = (name: string, id: string): Dataset =>
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

const renderSelector = (
  props: Partial<Parameters<typeof DatasetSelector>[0]> = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <DatasetSelector
        datasets={undefined}
        localStorageDatasetId=""
        errors={{}}
        setValue={vi.fn()}
        onCreateNew={vi.fn()}
        {...props}
      />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("DatasetSelector", () => {
  describe("given the project's datasets have not finished loading", () => {
    describe("when the picker renders", () => {
      /** @scenario "The dataset dropdown says it is loading" */
      it("shows that it is loading instead of an empty dropdown", () => {
        renderSelector({ datasets: undefined, isLoading: true });

        expect(screen.getByText("Loading datasets...")).toBeInTheDocument();
        expect(screen.queryByText("Select Dataset")).not.toBeInTheDocument();
        expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
      });
    });
  });

  describe("given the project has no datasets", () => {
    describe("when the picker renders", () => {
      /** @scenario "A project with no datasets is told so, not left blank" */
      it("says there are none yet and still offers to create one", () => {
        renderSelector({ datasets: [], isLoading: false });

        expect(screen.getByText("No datasets yet")).toBeInTheDocument();
        expect(screen.queryByText("Loading datasets...")).toBeNull();
        expect(
          screen.getByRole("button", { name: "+ Create New" }),
        ).toBeInTheDocument();
      });
    });
  });

  // Ark UI's Select does not mount its portaled options under jsdom, so a
  // dataset's presence in the dropdown is asserted through the value the
  // trigger resolves for it rather than by opening the list.
  describe("given the datasets have arrived", () => {
    describe("when the picker renders", () => {
      /** @scenario "The datasets appear once they arrive" */
      it("stops saying it is loading and offers a usable dropdown", () => {
        renderSelector({
          datasets: [buildDataset("offline evals", "dataset-1")],
          isLoading: false,
        });

        expect(screen.queryByText("Loading datasets...")).toBeNull();
        expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
        expect(screen.getByText("Select Dataset")).toBeInTheDocument();
        expect(screen.getByRole("combobox")).not.toBeDisabled();
      });

      /** @scenario "The datasets appear once they arrive" */
      it("resolves a dataset's name once it is in the list", () => {
        renderSelector({
          datasets: [buildDataset("offline evals", "dataset-1")],
          isLoading: false,
          localStorageDatasetId: "dataset-1",
        });

        expect(screen.getByRole("combobox")).toHaveTextContent("offline evals");
      });
    });
  });
});
