/**
 * @vitest-environment jsdom
 *
 * The trace's own fields as a reviewer corrects them in the summary: its input
 * beside its output, and its metadata as key and value rows. The keys that
 * decide where the trace belongs carry no editor at all
 * (specs/traces-v2/trace-edit-mode.feature).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TraceHeader } from "@langwatch/trace-contract";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({ isRedacted: false, isLoading: false }),
}));

vi.mock("~/features/traces-v2/hooks/useTraceEditOverlay", () => ({
  useAppliedTraceEditPatch: () => null,
}));

// The trace's comments are read once per surface. This suite is about the
// correction, so the surface reads none.
vi.mock("~/features/traces-v2/hooks/useAnchoredAnnotations", () => ({
  useAnchoredAnnotations: () => ({
    commentsAt: () => [],
    all: [],
    isLoading: false,
  }),
}));

// The comment action on each row carries its own composer, which reads over
// tRPC. It has its own tests; this suite is about the correction.
vi.mock(
  "~/features/traces-v2/components/TraceDrawer/anchoredComments/AnchorCommentButton",
  () => ({ AnchorCommentButton: () => null }),
);

vi.mock("~/features/traces-v2/hooks/useTraceHeader", () => ({
  useTraceHeaderCanonical: () => ({ data: undefined }),
}));

vi.mock("~/features/traces-v2/hooks/useTraceEvents", () => ({
  useTraceEvents: () => ({ events: [], isLoading: false }),
}));

vi.mock("~/features/traces-v2/hooks/useTraceEvaluations", () => ({
  useTraceEvaluations: () => ({
    rich: [],
    pendingCount: 0,
    isLoading: false,
  }),
}));

vi.mock("~/features/traces-v2/hooks/useTraceResources", () => ({
  useTraceResources: () => ({
    rootSpanId: null,
    resourceAttributes: {},
    scope: null,
    spans: [],
    bySpanId: {},
    isLoading: false,
  }),
}));

import { useDrawerStore } from "../../../../stores/drawerStore";
import {
  buildTraceEditPatch,
  useTraceEditStore,
} from "../../../../stores/traceEditStore";
import { TraceSummaryAccordions } from "../TraceSummaryAccordions";

const TRACE_ID = "trace-1";

const header = (overrides: Partial<TraceHeader> = {}): TraceHeader =>
  ({
    traceId: TRACE_ID,
    timestamp: 1_000,
    status: "ok",
    spanCount: 1,
    input: "what is the weather in Berlin?",
    output: "mild",
    attributes: {
      "metadata.environment": "staging",
      "metadata.reviewer": "unassigned",
      "gen_ai.conversation.id": "thread-1",
      "langwatch.origin": "sdk",
      "scenario.run_id": "run-1",
      "langwatch.labels": '["nightly"]',
    },
    ...overrides,
  }) as unknown as TraceHeader;

function renderSummary(trace: TraceHeader = header()) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceSummaryAccordions trace={trace} spans={[]} />
    </ChakraProvider>,
  );
}

function draftPatch() {
  return buildTraceEditPatch(useTraceEditStore.getState());
}

describe("correcting the trace's own fields in the summary", () => {
  beforeEach(() => {
    useTraceEditStore.getState().discard();
    useTraceEditStore.getState().startEditing({ traceId: TRACE_ID });
    useDrawerStore.setState({ isEditing: true });
  });

  afterEach(() => {
    cleanup();
    useDrawerStore.setState({ isEditing: false });
    useTraceEditStore.getState().discard();
  });

  describe("given the reviewer is editing the trace", () => {
    describe("when the summary renders", () => {
      /** @scenario "The trace input carries an editor while editing" */
      it("offers an editor for the input and for the output", () => {
        renderSummary();

        expect(screen.getByLabelText("Edit input")).toBeInTheDocument();
        expect(screen.getByLabelText("Edit output")).toBeInTheDocument();
      });
    });

    describe("when the input is rewritten", () => {
      /** @scenario "The trace input carries an editor while editing" */
      it("records the new input in the correction", () => {
        renderSummary();

        fireEvent.change(screen.getByLabelText("Edit input"), {
          target: { value: "what is the weather in Amsterdam?" },
        });

        expect(draftPatch().trace).toEqual({
          input: { value: "what is the weather in Amsterdam?" },
        });
      });
    });

    describe("when the input is hidden by a privacy rule", () => {
      /** @scenario "A redacted trace input carries no editor" */
      it("carries no editor for it", () => {
        renderSummary(
          header({
            input: null,
            inputRedacted: true,
            inputVisibleTo: "Admins",
          } as Partial<TraceHeader>),
        );

        expect(screen.queryByLabelText("Edit input")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Edit output")).toBeInTheDocument();
      });
    });
  });

  describe("given the trace carries metadata", () => {
    describe("when a value is changed", () => {
      /** @scenario "Changing a metadata value records it in the correction" */
      it("records the new value under the bare metadata key", () => {
        renderSummary();

        fireEvent.change(screen.getByLabelText("Edit metadata.environment"), {
          target: { value: "production" },
        });

        expect(draftPatch().trace).toEqual({
          metadata: { environment: "production" },
        });
      });
    });

    describe("when a key is removed", () => {
      /** @scenario "Removing a metadata key strikes it through and can be undone" */
      it("marks it removed and offers to restore it", () => {
        renderSummary();

        fireEvent.click(screen.getByLabelText("Remove metadata.reviewer"));

        expect(draftPatch().trace).toEqual({ metadata: { reviewer: null } });
        fireEvent.click(screen.getByLabelText("Restore metadata.reviewer"));
        expect(draftPatch().trace).toBeUndefined();
      });
    });

    describe("when a key the trace does not carry is added", () => {
      /** @scenario "Adding a metadata key records it in the correction" */
      it("records that key and its value", () => {
        renderSummary();

        fireEvent.change(screen.getByLabelText("New attribute name"), {
          target: { value: "reviewed_by" },
        });
        fireEvent.change(screen.getByLabelText("New attribute value"), {
          target: { value: "support" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add attribute" }));

        expect(draftPatch().trace).toEqual({
          metadata: { reviewed_by: "support" },
        });
      });
    });

    describe("when the reviewer looks at the keys that place the trace", () => {
      /** @scenario "The keys that place a trace carry no metadata editor" */
      it("offers no editor for them and still edits labels", () => {
        renderSummary();

        expect(
          screen.queryByLabelText("Edit gen_ai.conversation.id"),
        ).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Edit scenario.run_id")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Edit langwatch.origin")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Edit langwatch.labels")).toBeInTheDocument();
      });
    });
  });
});
