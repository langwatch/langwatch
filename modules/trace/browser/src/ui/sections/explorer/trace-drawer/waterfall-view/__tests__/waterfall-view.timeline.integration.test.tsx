// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationByTrace } from "../../../../../../behavior/use-annotations-by-trace-ids.ts";

const mocks = vi.hoisted(() => ({
  comments: [] as AnnotationByTrace[],
  scrollTo: vi.fn(),
}));

vi.mock("../../../../../../behavior/trace-host.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTraceHost: () => ({ hasPermission: () => true }),
}));
vi.mock("../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
  }),
}));

vi.mock("../../../../../../behavior/auth-session.ts", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("@langwatch/design-system/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("../../../../me/use-personal-feature-gate.ts", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: {},
  }),
}));

vi.mock("../../../../me/personal-feature-gate-dialog.tsx", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("../../../../../../features/annotation/behavior/use-anchored-annotations.ts", () => ({
  useAnchoredAnnotations: () => ({
    commentsAt: () => [],
    all: mocks.comments,
    isLoading: false,
  }),
}));

vi.mock("../../../../../../behavior/explorer/use-trace-query-args.ts", () => ({
  useTraceQueryArgs: () => ({ traceId: "trace-1" }),
}));

vi.mock("../../../../../../features/span/behavior/use-span-langwatch-signals.ts", () => ({
  useSpanLangwatchSignals: () => ({
    signalsBySpanId: new Map(),
    isFetched: true,
  }),
}));

vi.mock("../../../../../../features/span/behavior/use-span-logs.ts", () => ({
  useSpanLogs: () => ({ logsBySpanId: new Map(), isLoading: false }),
}));

vi.mock("../use-waterfall-editing.ts", () => ({
  useWaterfallEditing: () => ({
    isEditing: false,
    deletedSpanIds: new Set<string>(),
    draftNames: new Map<string, string>(),
    toggleSpanDeleted: vi.fn(),
  }),
}));

vi.mock("../use-correction-marks.ts", () => ({
  useCorrectionMarks: () => ({
    correctedSpanIds: new Set<string>(),
    deletedByCorrectionSpanIds: new Set<string>(),
  }),
}));

vi.mock("../../../../../../behavior/trace-api.ts", () => ({
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

import { WaterfallView } from "../waterfall-view.tsx";

/** Spec: modules/trace/specs/waterfall-timeline.feature */

const T0 = 1_760_037_418_193;

function span(over: Partial<SpanTreeNode> & Pick<SpanTreeNode, "spanId">): SpanTreeNode {
  return {
    parentSpanId: null,
    name: "step",
    type: "span",
    startTimeMs: T0,
    endTimeMs: T0 + 10,
    durationMs: 10,
    status: "ok",
    model: null,
    ...over,
  };
}

const SPANS = [
  span({ spanId: "root", name: "agent.run", endTimeMs: T0 + 2189, durationMs: 2189 }),
  span({
    spanId: "chat",
    parentSpanId: "root",
    type: "llm",
    startTimeMs: T0 + 20,
    endTimeMs: T0 + 671,
    durationMs: 651,
  }),
  span({
    spanId: "tool",
    parentSpanId: "root",
    type: "tool",
    startTimeMs: T0 + 1350,
    endTimeMs: T0 + 1728,
    durationMs: 378,
  }),
];

/** jsdom lays nothing out; the virtualizer renders rows only for a viewport with a size. */
beforeEach(() => {
  Element.prototype.scrollTo = mocks.scrollTo;
  for (const name of ["offsetHeight", "clientHeight", "scrollHeight"]) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: 400 });
  }
  for (const name of ["offsetWidth", "clientWidth"]) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: 1200 });
  }
});

afterEach(cleanup);

describe("given a trace drawer showing the Waterfall view", () => {
  /** @scenario "Each span row in the tree has its bar in the timeline" */
  it("draws one timeline bar for each span row in the tree", () => {
    const { container, getAllByTestId } = renderWithDesignSystem(
      <WaterfallView
        spans={SPANS}
        selectedSpanId={null}
        onSelectSpan={vi.fn()}
        onClearSpan={vi.fn()}
      />,
    );

    const timeline = container.querySelector<HTMLElement>('[style*="will-change"]');
    // The first child holds the grid lines; every other child is one row's bar.
    expect(timeline?.children.length).toBe(1 + SPANS.length);
    expect(getAllByTestId("waterfall-row")).toHaveLength(SPANS.length);
  });
});
