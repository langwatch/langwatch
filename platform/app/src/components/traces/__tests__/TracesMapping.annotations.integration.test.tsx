/**
 * @vitest-environment jsdom
 *
 * A dataset row carries what the reviewers said about the trace, which includes
 * the reviews left on one span rather than on the whole trace, and a new
 * dataset's annotations column is filled from them without further setup.
 * See specs/datasets/dataset-annotations-mapping.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { DatasetRecordEntry } from "@langwatch/dataset-contract";
import type { MappingState } from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";

const TRACE_ID = "95bf974e4f330faa31ed1decdeb0a590";
const SPAN_ID = "0af31b2c9d4e5f60";

const SPAN_ANCHORED_ANNOTATION = {
  id: "annotation-1",
  traceId: TRACE_ID,
  comment: "too terse",
  isThumbsUp: false,
  user: { name: "Ada" },
  email: null,
  scoreOptions: null,
  expectedOutput: null,
  anchorKind: "field",
  anchorId: SPAN_ID,
  anchorPath: "output",
};

const TRACE_LEVEL_ANNOTATION = {
  id: "annotation-2",
  traceId: TRACE_ID,
  comment: "reads well",
  isThumbsUp: true,
  user: { name: "Grace" },
  email: null,
  scoreOptions: null,
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
};

const mocks = vi.hoisted(() => ({
  /** Answers the way the annotations read does: anchored ones only on "all". */
  annotationsRead: vi.fn((_input: { anchor?: "trace" | "all" }) => ({
    data: [] as unknown[],
  })),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));

vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({
    spanNames: [],
    metadataKeys: [],
    evaluationNames: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("~/hooks/useProjectEventTypes", () => ({
  useProjectEventTypes: () => ({ eventTypes: [], isLoading: false }),
}));

vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: mocks.annotationsRead,
}));

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({ filterParams: {}, queryOpts: {} }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotationScore: { getAllActive: { useQuery: () => ({ data: [] }) } },
    traces: {
      getTracesWithSpansByThreadIds: { useQuery: () => ({ data: undefined }) },
      getFormattedSpansDigest: { useQuery: () => ({ data: undefined }) },
      getSampleTracesDataset: { useQuery: () => ({ data: [] }) },
    },
  },
}));

const { TracesMapping } = await import("../TracesMapping");

const REVIEWED_TRACE = {
  trace_id: TRACE_ID,
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [{ span_id: SPAN_ID, name: "web_search", type: "span" }],
} as unknown as Trace;

function renderMapping({
  targetFields,
  onMapping,
  onEntries,
}: {
  targetFields: string[];
  onMapping?: (mapping: MappingState) => void;
  onEntries?: (entries: DatasetRecordEntry[]) => void;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TracesMapping
        traces={[REVIEWED_TRACE]}
        traceMapping={{ mapping: {}, expansions: [] }}
        targetFields={targetFields}
        setTraceMapping={onMapping}
        setDatasetEntries={onEntries}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.annotationsRead.mockImplementation((input) => ({
    data:
      input.anchor === "all"
        ? [SPAN_ANCHORED_ANNOTATION, TRACE_LEVEL_ANNOTATION]
        : [TRACE_LEVEL_ANNOTATION],
  }));
});

afterEach(cleanup);

describe("given a trace a reviewer commented on one span of", () => {
  describe("when the add-to-dataset mapping reads its annotations", () => {
    /** @scenario "A comment left on a span reaches the dataset mapping" */
    it("includes the comment left on the span", async () => {
      const entries: DatasetRecordEntry[][] = [];
      renderMapping({
        targetFields: ["annotations"],
        onEntries: (rows) => entries.push(rows),
      });

      await waitFor(() => {
        const rows = entries.at(-1);
        expect(rows?.[0]?.annotations).toContain(
          "Ada (on web_search span (0af31b2c) · Output): too terse [thumbs down]",
        );
      });
      expect(entries.at(-1)?.[0]?.annotations).toContain("Grace: reads well [thumbs up]");
    });
  });
});

describe("given a new dataset whose last column is named annotations", () => {
  describe("when the mapping is set up for it", () => {
    /** @scenario "The annotations column is mapped to the readable annotation by default" */
    it("maps it to the annotations source and its ai_readable field", async () => {
      const mappings: MappingState[] = [];
      renderMapping({
        targetFields: ["annotations"],
        onMapping: (mapping) => mappings.push(mapping),
      });

      await waitFor(() => {
        expect(mappings.at(-1)?.mapping.annotations).toEqual({
          source: "annotations",
          key: "ai_readable",
          selectedFields: [],
        });
      });
    });

    /** @scenario "A new dataset does not split into one row per annotation" */
    it("leaves the one-row-per-annotation expansion off, so a trace stays one row", async () => {
      const mappings: MappingState[] = [];
      const entries: DatasetRecordEntry[][] = [];
      renderMapping({
        targetFields: ["annotations"],
        onMapping: (mapping) => mappings.push(mapping),
        onEntries: (rows) => entries.push(rows),
      });

      await waitFor(() => {
        expect(mappings.at(-1)?.mapping.annotations).toBeDefined();
      });
      expect(mappings.at(-1)?.expansions).toEqual([]);
      expect(entries.at(-1)).toHaveLength(1);
    });
  });
});

describe("given a dataset column with no inferred source", () => {
  describe("when the mapping is set up for it", () => {
    it("leaves the column unmapped", async () => {
      const mappings: MappingState[] = [];
      renderMapping({
        targetFields: ["something_custom"],
        onMapping: (mapping) => mappings.push(mapping),
      });

      await waitFor(() => {
        expect(mappings.at(-1)?.mapping.something_custom).toEqual({
          source: "",
          selectedFields: [],
        });
      });
    });
  });
});
