/**
 * @vitest-environment jsdom
 * Dataset's picker list, as it lends it to the workflow dataset node.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { WireOf } from "@langwatch/api/web";
import type { Dataset } from "@langwatch/dataset-contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatasetPickerList } from "../dataset-picker-list.tsx";

const turn10: WireOf<Dataset> = {
  id: "ds-1",
  projectId: "proj-1",
  name: "turn 10",
  slug: "turn-10",
  columnTypes: [
    { name: "query", type: "string" },
    { name: "context", type: "string" },
  ],
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:00:00.000Z",
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
  chunkCount: null,
  chunkOffsets: null,
};

const renderPicker = (onSelect = vi.fn()) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <DatasetPickerList datasets={[turn10]} onSelect={onSelect} />
    </ChakraProvider>,
  );
  return onSelect;
};

describe("dataset picker list", () => {
  afterEach(cleanup);

  /** @scenario Choose opens the shared dataset picker */
  it("offers a search and each dataset's entries, columns and last edit", () => {
    renderPicker();

    expect(screen.getByTestId("dataset-picker-search")).toBeInTheDocument();
    expect(screen.getByTestId("dataset-card-turn 10")).toBeInTheDocument();
    expect(screen.getByText("10 entries")).toBeInTheDocument();
    expect(screen.getByText("2 columns")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  /** @scenario Picking a dataset binds it to the node */
  it("hands the picked dataset and its columns back", async () => {
    const onSelect = renderPicker();

    await userEvent.click(screen.getByTestId("dataset-card-turn 10"));

    expect(onSelect).toHaveBeenCalledWith({
      datasetId: "ds-1",
      name: "turn 10",
      columnTypes: turn10.columnTypes,
    });
  });
});
