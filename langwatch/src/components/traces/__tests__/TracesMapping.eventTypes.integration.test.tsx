/**
 * @vitest-environment jsdom
 *
 * Integration tests for the "events" field mapping dropdown in TracesMapping.
 *
 * Like spans and evaluations, it must offer every event type the project
 * tracked in the last 30 days, not just the ones on the currently loaded
 * trace(s). Event types come from a separate bounded source
 * (useProjectEventTypes, backed by the analytics event-type filter options),
 * which this test mocks. These tests render the real component tree.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { MappingState } from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";
import { TracesMapping } from "../TracesMapping";

// Project-wide event types returned for the last 30 days — note that
// "thumbs_up" is NOT present on the loaded trace below.
const PROJECT_EVENT_TYPES = [
  { key: "thumbs_up", label: "thumbs_up" },
  { key: "thumbs_down", label: "thumbs_down" },
];

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
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
  useProjectEventTypes: () => ({
    eventTypes: PROJECT_EVENT_TYPES,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("~/hooks/useAnnotationsByTraceIds", () => ({
  useAnnotationsByTraceIds: () => ({ data: [] }),
}));

vi.mock(
  "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore",
  () => ({
    useEvaluationWizardStore: (selector: (state: unknown) => unknown) =>
      selector({ workbenchState: { task: undefined } }),
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [] }) },
    },
    traces: {
      getTracesWithSpansByThreadIds: { useQuery: () => ({ data: undefined }) },
      getFormattedSpansDigest: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

/** A trace with no events of the project-wide types above. */
const traceWithoutEvents = {
  trace_id: "trace-1",
  project_id: "test-project",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [],
  events: [],
} as unknown as Trace;

function renderEventsMapping() {
  const traceMapping: MappingState = {
    mapping: {
      event_col: { source: "events" as never, key: "", subkey: "" },
    },
    expansions: [],
  };
  return render(
    <ChakraProvider value={defaultSystem}>
      <TracesMapping
        traces={[traceWithoutEvents]}
        traceMapping={traceMapping}
        targetFields={["event_col"]}
      />
    </ChakraProvider>,
  );
}

describe("TracesMapping events dropdown (integration)", () => {
  afterEach(() => cleanup());

  describe("when a project event type is absent from the loaded trace", () => {
    /** @scenario Event types from the project are offered even when absent from the open trace */
    it("offers the project event type for mapping", async () => {
      renderEventsMapping();

      expect(
        await screen.findByRole("option", { name: "thumbs_up" }),
      ).toBeInTheDocument();
    });
  });
});
