/**
 * @vitest-environment jsdom
 *
 * The reviewer's corrections are opt-in per read, and only the dataset path
 * opts in. The mapping reads the conversation behind the traces it is mapping
 * for its thread_* columns, so that read has to follow the traces it was handed
 * rather than always asking for corrections: an evaluator is set up against the
 * captured trace.
 * See specs/traces-v2/trace-edit-overlay.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { Trace } from "~/server/tracer/types";

const mocks = vi.hoisted(() => ({
  threadQuery: vi.fn((_input: { withEditOverlay?: boolean }) => ({
    data: undefined,
  })),
  sampleTraces: [] as unknown[],
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
    annotationScore: { getAllActive: { useQuery: () => ({ data: [] }) } },
    traces: {
      getTracesWithSpansByThreadIds: { useQuery: mocks.threadQuery },
      getFormattedSpansDigest: { useQuery: () => ({ data: undefined }) },
      getSampleTracesDataset: {
        useQuery: () => ({ data: mocks.sampleTraces }),
      },
    },
  },
}));

const { TracesMapping } = await import("../TracesMapping");
const { EvaluatorTracesMapping } = await import(
  "../../evaluations/EvaluatorTracesMapping"
);

const TRACE_IN_A_THREAD = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: { thread_id: "thread-1" },
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [],
} as unknown as Trace;

/** What the thread read asked for on its first call. */
function threadReadInput(): { withEditOverlay?: boolean } {
  return mocks.threadQuery.mock.calls[0]?.[0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sampleTraces = [TRACE_IN_A_THREAD];
});

afterEach(cleanup);

describe("given a mapping filled from traces that carry corrections", () => {
  describe("when it reads the conversation behind them", () => {
    /** @scenario "A field mapping reads the conversation the way it reads the traces" */
    it("reads the thread with corrections too", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <TracesMapping
            traces={[TRACE_IN_A_THREAD]}
            traceMapping={{ mapping: {}, expansions: [] }}
            targetFields={["input"]}
            shouldApplyCorrections
          />
        </ChakraProvider>,
      );

      expect(threadReadInput().withEditOverlay).toBe(true);
    });
  });
});

describe("given a mapping filled from the traces as they were captured", () => {
  describe("when it reads the conversation behind them", () => {
    /** @scenario "A field mapping reads the conversation the way it reads the traces" */
    it("reads the thread as captured", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <TracesMapping
            traces={[TRACE_IN_A_THREAD]}
            traceMapping={{ mapping: {}, expansions: [] }}
            targetFields={["input"]}
          />
        </ChakraProvider>,
      );

      expect(threadReadInput().withEditOverlay).toBe(false);
    });
  });
});

describe("given an evaluator being set up against sample traces", () => {
  describe("when its mapping reads the conversation behind them", () => {
    /** @scenario "A field mapping reads the conversation the way it reads the traces" */
    it("reads the thread as captured", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <EvaluatorTracesMapping
            traceMapping={{ mapping: {}, expansions: [] }}
            targetFields={["input"]}
          />
        </ChakraProvider>,
      );

      expect(threadReadInput().withEditOverlay).toBe(false);
    });
  });
});
