/**
 * @vitest-environment jsdom
 *
 * Integration tests for the "spans" field mapping dropdown in TracesMapping.
 *
 * The dropdown must offer every span name the project produced in the last 30
 * days, not just the span names present on the currently loaded trace(s).
 * A customer reported a span that existed in their project not being offered
 * for mapping because the drawer only listed the open trace's spans. These
 * tests render the real component tree and assert the merged behaviour.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { Trace } from "~/server/tracer/types";
import { TracesMapping } from "../TracesMapping";

// Project-wide span names returned for the last 30 days — note that
// "Research.aexecute_stream" is NOT present on the loaded trace below.
const PROJECT_SPAN_NAMES = [
  { key: "Research.aexecute_stream", label: "Research.aexecute_stream" },
  { key: "Classification.aexecute_stream", label: "Classification.aexecute_stream" },
];

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({
    spanNames: PROJECT_SPAN_NAMES,
    metadataKeys: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("~/hooks/useProjectEventTypes", () => ({
  useProjectEventTypes: () => ({ eventTypes: [], isLoading: false, error: null }),
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

/** A trace that contains "step_2a_research_iter1" but NOT "Research.aexecute_stream". */
const traceWithoutResearchSpan = {
  trace_id: "trace-1",
  project_id: "test-project",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [
    {
      span_id: "span-1",
      trace_id: "trace-1",
      type: "span",
      name: "step_2a_research_iter1",
      timestamps: { started_at: 1, finished_at: 2 },
    },
  ],
} as unknown as Trace;

function renderSpansMapping() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TracesMapping
        traces={[traceWithoutResearchSpan]}
        traceMapping={{ mapping: {}, expansions: [] }}
        targetFields={["spans"]}
      />
    </ChakraProvider>,
  );
}

/** Open the searchable span/key dropdown (it shows "* (any span)" until opened). */
async function openKeyDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("* (any span)"));
}

describe("TracesMapping spans dropdown (integration)", () => {
  afterEach(() => cleanup());

  describe("when a project span name is absent from the loaded trace", () => {
    /** @scenario Span names from the project are offered even when absent from the open trace */
    it("offers the project span name for mapping", async () => {
      const user = userEvent.setup();
      renderSpansMapping();
      await openKeyDropdown(user);

      expect(
        await screen.findByRole("option", {
          name: "Research.aexecute_stream",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("when a span exists on the loaded trace", () => {
    /** @scenario Span names from the open trace are always offered */
    it("offers the loaded trace's span name for mapping", async () => {
      const user = userEvent.setup();
      renderSpansMapping();
      await openKeyDropdown(user);

      expect(
        await screen.findByRole("option", {
          name: "step_2a_research_iter1",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("when typing into the span dropdown", () => {
    /** @scenario The span name dropdown is searchable for large projects */
    it("filters the options down to the typed text", async () => {
      const user = userEvent.setup();
      renderSpansMapping();
      await openKeyDropdown(user);

      await user.keyboard("Classification");

      expect(
        await screen.findByRole("option", {
          name: "Classification.aexecute_stream",
        }),
      ).toBeInTheDocument();
      // A non-matching span name is filtered out of the menu.
      expect(
        screen.queryByRole("option", { name: "Research.aexecute_stream" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when a project span name is selected", () => {
    /** @scenario Selecting a project span name lets me map its subfields */
    it("offers the span input, output, params and contexts subfields", async () => {
      const user = userEvent.setup();
      renderSpansMapping();
      await openKeyDropdown(user);

      await user.click(
        await screen.findByRole("option", { name: "Research.aexecute_stream" }),
      );

      // Scope the subfield assertions to the span subkey <select> (identified by
      // its "* (full span object)" option) so they don't collide with the
      // source dropdown, which also has options named "input" / "output".
      const fullSpanOption = await screen.findByRole("option", {
        name: "* (full span object)",
      });
      const subkeySelect = fullSpanOption.closest("select");
      expect(subkeySelect).not.toBeNull();

      for (const subfield of ["input", "output", "params", "contexts"]) {
        expect(
          within(subkeySelect!).getByRole("option", { name: subfield }),
        ).toBeInTheDocument();
      }
    });
  });
});
