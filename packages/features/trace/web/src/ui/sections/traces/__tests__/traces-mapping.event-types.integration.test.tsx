/**
 * Integration tests for the "events" field mapping dropdown in TracesMapping.
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { MappingState } from "@langwatch/trace-contract";
import type { Trace } from "@langwatch/trace-contract";
import { TracesMapping } from "../traces-mapping";

// Project-wide event types returned for the last 30 days — note that
// "thumbs_up" is NOT present on the loaded trace below.
const PROJECT_EVENT_TYPES = [
  { key: "thumbs_up", label: "thumbs_up" },
  { key: "thumbs_down", label: "thumbs_down" },
];

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("../../use-project-span-names", () => ({
  useProjectSpanNames: () => ({
    spanNames: [],
    metadataKeys: [],
    evaluationNames: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../use-project-event-types", () => ({
  useProjectEventTypes: () => ({
    eventTypes: PROJECT_EVENT_TYPES,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../use-annotations-by-trace-ids", () => ({
  useAnnotationsByTraceIds: () => ({ data: [] }),
}));

vi.mock("../../../../behavior/trace-api", () => ({
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
      const user = userEvent.setup();
      renderEventsMapping();
      // Open the searchable key dropdown (shows "* (any event)" until opened).
      await user.click(await screen.findByText("* (any event)"));

      expect(await screen.findByRole("option", { name: "thumbs_up" })).toBeInTheDocument();
    });
  });
});
