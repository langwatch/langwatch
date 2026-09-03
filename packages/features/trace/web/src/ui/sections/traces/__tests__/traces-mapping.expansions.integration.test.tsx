/**
 * @vitest-environment jsdom
 *
 * The Expansions switches. Each one is a switch about its own expansion, and
 * turning them all off is an answer the reader is allowed to give: a mapping
 * with nothing expanded is the one that keeps a row per trace.
 * See specs/datasets/add-to-dataset-span-mapping.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { MappingState } from "@langwatch/trace-contract";
import type { Trace } from "@langwatch/trace-contract";

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));

vi.mock("../../use-project-span-names", () => ({
  useProjectSpanNames: () => ({
    spanNames: [],
    metadataKeys: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../use-project-event-types", () => ({
  useProjectEventTypes: () => ({ eventTypes: [], isLoading: false }),
}));

vi.mock("../../use-annotations-by-trace-ids", () => ({
  useAnnotationsByTraceIds: () => ({ data: [] }),
}));

vi.mock("../../trace-api", () => ({
  api: {
    annotationScore: { getAllActive: { useQuery: () => ({ data: [] }) } },
    traces: {
      getTracesWithSpansByThreadIds: { useQuery: () => ({ data: undefined }) },
      getFormattedSpansDigest: { useQuery: () => ({ data: undefined }) },
      getSampleTracesDataset: { useQuery: () => ({ data: [] }) },
    },
  },
}));

const { TracesMapping } = await import("../traces-mapping");

const TRACE = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [],
} as unknown as Trace;

/** A mapping whose columns make both the span and the annotation expansion available. */
const BOTH_EXPANDABLE = {
  spans_column: { source: "spans" as const },
  annotations_column: { source: "annotations" as const },
};

const setTraceMapping = vi.fn();

/** Pushes a value down as if the host's re-read had just answered with it. */
let handBackFromTheServer: ((mapping: MappingState) => void) | null = null;

/** The expansions the mapping last reported, in the order it reported them. */
function lastReportedExpansions(): string[] {
  const calls = setTraceMapping.mock.calls;
  return (calls[calls.length - 1]?.[0]?.expansions ?? []) as string[];
}

/**
 * The mapping as its real hosts render it: they hold the mapping in state and
 * hand it straight back down, so every change the mapping reports comes back to
 * it as its own input. Rendering it uncontrolled hides anything that goes wrong
 * on that round trip, which is where turning an expansion off used to be undone.
 */
function ControlledMapping({
  mapping,
  expansions,
  targetFields,
}: {
  mapping: Record<string, { source: string }>;
  expansions: string[];
  targetFields: string[];
}) {
  const [traceMapping, setLocal] = React.useState<MappingState>({
    mapping,
    expansions,
  } as MappingState);
  // The host re-reads the mapping from the server, so a test can play that
  // answer landing late, and landing stale.
  handBackFromTheServer = setLocal;

  return (
    <TracesMapping
      traces={[TRACE]}
      traceMapping={traceMapping}
      targetFields={targetFields}
      setTraceMapping={(next) => {
        setTraceMapping(next);
        setLocal(next);
      }}
    />
  );
}

function renderMapping({ expansions }: { expansions: string[] }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ControlledMapping
        mapping={BOTH_EXPANDABLE}
        expansions={expansions}
        targetFields={["spans_column", "annotations_column"]}
      />
    </ChakraProvider>,
  );
}

/**
 * One switch, by the name it announces. Chakra's Switch is a label wrapping a
 * hidden checkbox, so it reaches the accessibility tree as a checkbox named
 * after its own words.
 */
const switchNamed = (name: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", { name });

/** The words of one switch, which is what a reader actually clicks. */
const labelOf = (label: string) => screen.getByText(label);

/** The source dropdown of a column nothing has been mapped to yet. */
function unmappedColumnSelect(): HTMLSelectElement {
  const selects = screen.getAllByRole<HTMLSelectElement>("combobox");
  const unmapped = selects.find((select) => select.value === "");
  if (!unmapped) throw new Error("Every column is already mapped");
  return unmapped;
}

/**
 * Matched on what it reads rather than on where it sits: a mapped column also
 * renders a key dropdown beside its source one, and both are comboboxes.
 */
function columnSourceSelect(source: string): HTMLSelectElement {
  const selects = screen.getAllByRole<HTMLSelectElement>("combobox");
  const mapped = selects.find((select) => select.value === source);
  if (!mapped) throw new Error(`No column is mapped to ${source}`);
  return mapped;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("given a mapping that offers both the annotation and the span expansion", () => {
  describe("when both are enabled and I turn off the span one", () => {
    /** @scenario "Each expansion switch toggles only its own expansion" */
    it("leaves the annotation expansion alone", async () => {
      const user = userEvent.setup();
      renderMapping({ expansions: ["spans.all.span_id", "annotations.id"] });

      expect(switchNamed("One row per span")).toBeChecked();
      expect(switchNamed("One row per annotation")).toBeChecked();

      await user.click(labelOf("One row per span"));

      expect(switchNamed("One row per span")).not.toBeChecked();
      expect(switchNamed("One row per annotation")).toBeChecked();
      expect(lastReportedExpansions()).toEqual(["annotations.id"]);
    });
  });

  describe("when only the span expansion is enabled and I turn it off", () => {
    /** @scenario "The last expansion can be turned off" */
    it("stays off rather than coming back", async () => {
      const user = userEvent.setup();
      renderMapping({ expansions: ["spans.all.span_id"] });

      await user.click(labelOf("One row per span"));

      expect(switchNamed("One row per span")).not.toBeChecked();
      expect(lastReportedExpansions()).toEqual([]);
    });
  });

  // The host saves the mapping to the server and re-reads it, so the stored
  // mapping arrives back late and can still be the one from before the click.
  // Turning the last expansion off used to read as "nothing chosen yet", and
  // that late answer put the stored expansions back — including the one the
  // reader never touched.
  describe("when the stored mapping arrives back stale after I turn the last one off", () => {
    /** @scenario "The last expansion can be turned off" */
    it("keeps them off rather than taking the stale answer", async () => {
      const user = userEvent.setup();
      const stored = ["spans.all.span_id", "annotations.id"];
      render(
        <ChakraProvider value={defaultSystem}>
          <ControlledMapping
            mapping={BOTH_EXPANDABLE}
            expansions={stored}
            targetFields={["spans_column", "annotations_column"]}
          />
        </ChakraProvider>,
      );

      await user.click(labelOf("One row per span"));
      await user.click(labelOf("One row per annotation"));

      // The re-read lands, still carrying what was stored before the clicks.
      act(() => {
        handBackFromTheServer?.({
          mapping: BOTH_EXPANDABLE,
          expansions: stored,
        } as MappingState);
      });

      expect(switchNamed("One row per span")).not.toBeChecked();
      expect(switchNamed("One row per annotation")).not.toBeChecked();
    });
  });
});

describe("given a column that has not been mapped to anything yet", () => {
  describe("when I map it to the spans source", () => {
    /** @scenario "The span expansion starts off" */
    it("offers the span expansion without turning it on", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <ControlledMapping
            mapping={{ spans_column: { source: "" } }}
            expansions={[]}
            targetFields={["spans_column"]}
          />
        </ChakraProvider>,
      );

      await user.selectOptions(unmappedColumnSelect(), "spans");

      expect(switchNamed("One row per span")).not.toBeChecked();
      expect(lastReportedExpansions()).toEqual([]);
    });
  });

  describe("when I map it to the annotations source", () => {
    /** @scenario "Mapping annotations turns their expansion on" */
    it("turns the annotation expansion on, which is what mapping them means", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <ControlledMapping
            mapping={{ annotations_column: { source: "" } }}
            expansions={[]}
            targetFields={["annotations_column"]}
          />
        </ChakraProvider>,
      );

      await user.selectOptions(unmappedColumnSelect(), "annotations");

      expect(switchNamed("One row per annotation")).toBeChecked();
    });
  });
});

describe("given a mapping whose span expansion the reader turned on", () => {
  describe("when its column is remapped to another source and back", () => {
    /** @scenario "An expansion I turned on survives its column being remapped and mapped back" */
    it("comes back on rather than starting the choice over", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <ControlledMapping
            mapping={{ spans_column: { source: "spans" } }}
            expansions={["spans.all.span_id"]}
            targetFields={["spans_column"]}
          />
        </ChakraProvider>,
      );
      expect(switchNamed("One row per span")).toBeChecked();
      const columnSource = columnSourceSelect("spans");

      await user.selectOptions(columnSource, "trace_id");
      await user.selectOptions(columnSource, "spans");

      expect(switchNamed("One row per span")).toBeChecked();
      expect(lastReportedExpansions()).toEqual(["spans.all.span_id"]);
    });
  });
});
