/**
 * @vitest-environment jsdom
 *
 * The Expansions switches as the Add to Dataset drawer actually composes them,
 * beside the preview table. A field hands its own id to every control under it,
 * so a field wrapped around both halves gave every switch and every preview
 * checkbox the same id, and a click on a switch went wherever that id resolved
 * first. Rendering the mapping on its own cannot see that.
 * See specs/datasets/add-to-dataset-span-mapping.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { Dataset } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { DatasetColumns } from "~/server/datasets/types";
import type { Trace } from "~/server/tracer/types";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));

vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({
    spanNames: [],
    metadataKeys: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("~/hooks/useProjectEventTypes", () => ({
  useProjectEventTypes: () => ({ eventTypes: [], isLoading: false }),
}));

vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: () => ({ data: [] }),
}));

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({ filterParams: {}, queryOpts: {} }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({ dataset: { getAll: { invalidate: vi.fn() } } }),
    annotationScore: { getAllActive: { useQuery: () => ({ data: [] }) } },
    dataset: { updateMapping: { useMutation: () => ({ mutate: vi.fn() }) } },
    traces: {
      getTracesWithSpansByThreadIds: { useQuery: () => ({ data: undefined }) },
      getFormattedSpansDigest: { useQuery: () => ({ data: undefined }) },
      getSampleTracesDataset: { useQuery: () => ({ data: [] }) },
    },
  },
}));

const { DatasetMappingPreview } = await import("../DatasetMappingPreview");

const TRACE = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [],
} as unknown as Trace;

const COLUMN_TYPES: DatasetColumns = [
  { name: "spans_column", type: "json" },
  { name: "annotations_column", type: "json" },
];

/** A dataset whose stored mapping offers both the span and the annotation expansion. */
const DATASET = {
  id: "dataset-1",
  name: "runbook quality",
  columnTypes: COLUMN_TYPES,
  mapping: {
    traceMapping: {
      mapping: {
        spans_column: { source: "spans" },
        annotations_column: { source: "annotations" },
      },
      expansions: [],
    },
  },
} as unknown as Dataset;

/**
 * One switch, by the name it announces. Chakra's Switch is a label wrapping a
 * hidden checkbox, so it reaches the accessibility tree as a checkbox named
 * after its own words. A switch that borrowed a field's id announces the
 * field's label instead and cannot be found here at all.
 */
const switchNamed = (name: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", { name });

function renderPreview() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DatasetMappingPreview
        traces={[TRACE]}
        columnTypes={COLUMN_TYPES}
        rowData={[{ id: "row-1", selected: true }]}
        selectedDataset={DATASET}
        onEditColumns={vi.fn()}
        onRowDataChange={vi.fn()}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("given the drawer's mapping and preview side by side", () => {
  describe("when I click the words beside an expansion switch", () => {
    /** @scenario "An expansion switch answers to its own label in the drawer" */
    it("turns that expansion on", async () => {
      const user = userEvent.setup();
      renderPreview();

      await user.click(screen.getByText("One row per span"));

      expect(switchNamed("One row per span")).toBeChecked();
    });

    /** @scenario "An expansion switch answers to its own label in the drawer" */
    it("leaves every other switch and the preview's own checkboxes alone", async () => {
      const user = userEvent.setup();
      renderPreview();

      await user.click(screen.getByText("One row per span"));

      expect(switchNamed("One row per annotation")).not.toBeChecked();
      expect(switchNamed("Select all rows")).toBeChecked();
    });
  });

  describe("when the switches are rendered", () => {
    /** @scenario "An expansion switch answers to its own label in the drawer" */
    it("gives each control its own id, so a click lands where it was aimed", () => {
      renderPreview();

      const ids = screen
        .getAllByRole<HTMLInputElement>("checkbox")
        .map((control) => control.id)
        .filter(Boolean);

      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
