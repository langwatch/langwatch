/**
 * @vitest-environment jsdom
 *
 * Bringing the selected span's row into view, which is what makes naming a span
 * from a comment worth anything, and what the waterfall does with a comment
 * whose span the trace no longer has.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

const mocks = vi.hoisted(() => ({
  comments: [] as AnnotationByTrace[],
  scrollTo: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: {},
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("../../../../hooks/useAnchoredAnnotations", () => ({
  useAnchoredAnnotations: () => ({
    commentsAt: () => [],
    all: mocks.comments,
    isLoading: false,
  }),
}));

vi.mock("../../../../hooks/useTraceQueryArgs", () => ({
  useTraceQueryArgs: () => ({ traceId: "trace-1" }),
}));

vi.mock("../../../../hooks/useSpanLangwatchSignals", () => ({
  useSpanLangwatchSignals: () => ({
    signalsBySpanId: new Map(),
    isFetched: true,
  }),
}));

vi.mock("../../../../hooks/useSpanLogs", () => ({
  useSpanLogs: () => ({ logsBySpanId: new Map(), isLoading: false }),
}));

vi.mock("../useWaterfallEditing", () => ({
  useWaterfallEditing: () => ({
    isEditing: false,
    deletedSpanIds: new Set<string>(),
    draftNames: new Map<string, string>(),
    toggleSpanDeleted: vi.fn(),
  }),
}));

vi.mock("../useCorrectionMarks", () => ({
  useCorrectionMarks: () => ({
    correctedSpanIds: new Set<string>(),
    deletedByCorrectionSpanIds: new Set<string>(),
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: () => [{ data: [], isLoading: false, isError: false }],
    useUtils: () => ({
      annotation: {
        getByTraceId: { invalidate: vi.fn() },
        getByTraceIds: { invalidate: vi.fn() },
      },
      traceEditOverlay: { getByTraceId: { invalidate: vi.fn() } },
    }),
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      updateByTraceId: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { ROW_HEIGHT } from "../types";
import { WaterfallView } from "../WaterfallView";

const TRACE_ID = "trace-1";
const DEEP_SPAN = "span-30";

function span(over: Partial<SpanTreeNode>): SpanTreeNode {
  return {
    parentSpanId: null,
    name: "step",
    type: "span",
    startTimeMs: 0,
    endTimeMs: 10,
    durationMs: 10,
    status: "ok",
    model: null,
    ...over,
  } as unknown as SpanTreeNode;
}

/** A root and forty children, which is more rows than a viewport holds. */
function longTrace(): SpanTreeNode[] {
  return [
    span({ spanId: "root", name: "handler" }),
    ...Array.from({ length: 40 }, (_, i) =>
      span({
        spanId: `span-${i}`,
        parentSpanId: "root",
        // Distinct names so no five of them fold into a sibling group.
        name: `step ${i}`,
        startTimeMs: i,
        endTimeMs: i + 1,
      }),
    ),
  ];
}

/** Six identical siblings, which the tree folds into one group row. */
function foldedTrace(): SpanTreeNode[] {
  return [
    span({ spanId: "root", name: "handler" }),
    ...Array.from({ length: 6 }, (_, i) =>
      span({ spanId: `tool-${i}`, parentSpanId: "root", name: "read_file" }),
    ),
  ];
}

function comment(over: Partial<AnnotationByTrace>): AnnotationByTrace {
  return {
    id: "annotation-1",
    traceId: TRACE_ID,
    comment: "this step should not have run",
    email: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    expectedOutput: null,
    isThumbsUp: null,
    scoreOptions: {},
    user: { id: "user-2", name: "Ada", image: null },
    anchorKind: "span",
    anchorId: "span-gone",
    anchorPath: null,
    ...over,
  } as unknown as AnnotationByTrace;
}

function renderWaterfall({
  spans,
  selectedSpanId,
}: {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WaterfallView
        spans={spans}
        selectedSpanId={selectedSpanId}
        onSelectSpan={vi.fn()}
        onClearSpan={vi.fn()}
      />
    </ChakraProvider>,
  );
}

/**
 * jsdom lays nothing out, and a virtualized list with a zero-height viewport
 * renders no rows and scrolls nowhere. Give every element a viewport so the
 * waterfall behaves as it does on screen, and capture the scroll it asks for,
 * which jsdom itself does not implement.
 */
const VIEWPORT_HEIGHT_PX = 400;
const SCROLLABLE_HEIGHT_PX = 2000;

beforeEach(() => {
  mocks.comments = [];
  mocks.scrollTo.mockClear();
  Element.prototype.scrollTo = mocks.scrollTo;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: VIEWPORT_HEIGHT_PX,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 800,
  });
  // The virtualizer clamps a scroll to what the scroller says it can travel,
  // which jsdom reports as nothing at all.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: VIEWPORT_HEIGHT_PX,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    value: SCROLLABLE_HEIGHT_PX,
  });
});

afterEach(cleanup);

describe("given a trace with more spans than the waterfall shows at once", () => {
  /** @scenario "Jumping to a span comment selects that span and brings its row into view" */
  it("scrolls far enough to show the selected span's row", () => {
    renderWaterfall({ spans: longTrace(), selectedSpanId: DEEP_SPAN });

    expect(mocks.scrollTo).toHaveBeenCalled();
    const [{ top }] = mocks.scrollTo.mock.calls.at(-1) as [{ top: number }];
    // The row sits 31 rows down, well past a viewport that holds fourteen, so
    // the waterfall has to travel far enough for the viewport to reach it.
    const rowEndPx = 32 * ROW_HEIGHT;
    expect(top).toBeGreaterThan(0);
    expect(top + VIEWPORT_HEIGHT_PX).toBeGreaterThanOrEqual(rowEndPx);
  });

  /** @scenario "Jumping to a span comment selects that span and brings its row into view" */
  it("unfolds a span the tree had folded into a group of repeated siblings", () => {
    renderWaterfall({ spans: foldedTrace(), selectedSpanId: "tool-4" });

    expect(screen.getAllByText("read_file").length).toBeGreaterThan(1);
  });
});

describe("given a comment about a span the trace no longer has", () => {
  /** @scenario "A comment whose anchor is gone puts no count anywhere in the trace" */
  it("puts no count on any row", () => {
    mocks.comments = [comment({})];

    const { container } = renderWaterfall({
      spans: longTrace(),
      selectedSpanId: null,
    });

    expect(container.querySelectorAll('[aria-label*="comment on"]')).toHaveLength(0);
  });
});

describe("given several spans of the trace carry comments", () => {
  /** @scenario "The trace view grows no rail for comments" */
  it("reserves no column for them and keeps the waterfall's width", () => {
    const uncommented = renderWaterfall({
      spans: longTrace(),
      selectedSpanId: null,
    });
    const widthBefore = (
      uncommented.container.firstElementChild?.firstElementChild as HTMLElement
    ).style.width;
    cleanup();

    mocks.comments = [
      comment({ id: "a", anchorId: "span-1" }),
      comment({ id: "b", anchorId: "span-2" }),
    ];
    const commented = renderWaterfall({
      spans: longTrace(),
      selectedSpanId: null,
    });

    const treePane = commented.container.firstElementChild
      ?.firstElementChild as HTMLElement;
    expect(treePane.style.width).toBe(widthBefore);
    expect(
      commented.container.querySelector('[data-testid^="turn-annotation-rail"]'),
    ).not.toBeInTheDocument();
  });
});
