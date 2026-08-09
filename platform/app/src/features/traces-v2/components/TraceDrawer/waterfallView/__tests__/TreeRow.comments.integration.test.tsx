/**
 * @vitest-environment jsdom
 *
 * The comment action on a waterfall row: what it says when there is no room to
 * write it down, what a commented span shows at rest, and what a reader who may
 * not write annotations is offered.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";

const mocks = vi.hoisted(() => ({
  canManage: true,
  create: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage" ? mocks.canManage : true,
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

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      annotation: {
        getByTraceId: { invalidate: vi.fn() },
        getByTraceIds: { invalidate: vi.fn() },
      },
      traceEditOverlay: { getByTraceId: { invalidate: vi.fn() } },
    }),
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: mocks.create }) },
      updateByTraceId: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { useSpanHoverStore } from "../../../../stores/spanHoverStore";
import { TreeRow } from "../TreeRow";
import type { WaterfallTreeNode } from "../types";

const TRACE_ID = "trace-1";
const SPAN_ID = "span-7";

function span(): SpanTreeNode {
  return {
    spanId: SPAN_ID,
    parentSpanId: null,
    name: "web_search",
    type: "tool",
    startTimeMs: 0,
    endTimeMs: 100,
    durationMs: 100,
    status: "ok",
    model: null,
  } as unknown as SpanTreeNode;
}

function node(): WaterfallTreeNode {
  return { span: span(), children: [], depth: 0, isOrphaned: false };
}

function comment(over: Partial<AnnotationByTrace> = {}): AnnotationByTrace {
  return {
    id: "annotation-1",
    traceId: TRACE_ID,
    comment: "this search returned nothing",
    email: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    expectedOutput: null,
    isThumbsUp: null,
    scoreOptions: {},
    user: { id: "user-2", name: "Ada", image: null },
    anchorKind: "span",
    anchorId: SPAN_ID,
    anchorPath: null,
    ...over,
  } as unknown as AnnotationByTrace;
}

function renderRow(
  comments: AnnotationByTrace[],
  { isPinned = false }: { isPinned?: boolean } = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TreeRow
        node={node()}
        rootStart={0}
        rootDuration={1000}
        isSelected={false}
        isPrompt={false}
        logCount={0}
        isPinned={isPinned}
        isCollapsed={false}
        hasChildren={false}
        hiddenDescendantCount={0}
        isDimmed={false}
        signals={[]}
        traceId={TRACE_ID}
        comments={comments}
        onToggleCollapse={vi.fn()}
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mocks.canManage = true;
  mocks.create.mockClear();
  useSpanHoverStore.setState({ hoveredSpanId: null });
});

afterEach(cleanup);

/** The row itself, which is what the pointer arrives on. */
const rowOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="waterfall-row-actions"]')
    ?.parentElement as HTMLElement;

const actionCluster = () => screen.getByTestId("waterfall-row-actions");

describe("given a span that carries two comments", () => {
  const comments = [
    comment({ id: "annotation-1", comment: "this search returned nothing" }),
    comment({ id: "annotation-2", comment: "and it retried three times" }),
  ];

  /** @scenario "A commented span carries a count on its row and opens its thread there" */
  it("shows on the row that the span carries two comments", () => {
    renderRow(comments);

    expect(
      screen.getByRole("button", { name: "2 comments on web_search" }),
    ).toBeInTheDocument();
  });

  /** @scenario "A commented span carries a count on its row and opens its thread there" */
  it("opens both comments and a way to add another", async () => {
    renderRow(comments);

    fireEvent.click(
      screen.getByRole("button", { name: "2 comments on web_search" }),
    );

    expect(
      await screen.findByText("this search returned nothing"),
    ).toBeInTheDocument();
    expect(screen.getByText("and it retried three times")).toBeInTheDocument();
    expect(screen.getByText("Add annotation")).toBeInTheDocument();
  });

  /** @scenario "Comments are readable without starting to annotate" */
  it("reads the count without the row being hovered", () => {
    const { container } = renderRow(comments);

    const action = container.querySelector(
      '[aria-label="2 comments on web_search"]',
    );
    expect(action).not.toHaveAttribute("aria-hidden", "true");
  });
});

describe("given a span with nothing said about it", () => {
  /** @scenario "A comment action with no room for a label names the row it acts on" */
  it("names the span in the action that has no room for a label", () => {
    const { container } = renderRow([]);

    expect(
      container.querySelector('[aria-label="Comment on web_search"]'),
    ).toBeInTheDocument();
  });

  /** @scenario "A comment action with no room for a label names the row it acts on" */
  it("keeps the action inline on the row rather than behind a menu", () => {
    const { container } = renderRow([]);

    const commentAction = container.querySelector(
      '[aria-label="Comment on web_search"]',
    );
    const pin = container.querySelector('[aria-label="Pin span tab"]');
    const row = pin?.parentElement;
    expect(row?.contains(commentAction!)).toBe(true);
    expect(
      container.querySelector('[aria-label="Row actions"]'),
    ).not.toBeInTheDocument();
  });
});

describe("given a span whose name fills its column", () => {
  describe("when the pointer is not on its row", () => {
    /** @scenario "A waterfall row's hidden actions take none of the name's room" */
    it("leaves the name the whole column, with the actions taking none of it", () => {
      const { container } = renderRow([]);

      expect(actionCluster()).toHaveAttribute("data-roomed", "false");
      expect(
        container.querySelector('[aria-label="Pin span tab"]'),
      ).toHaveAttribute("aria-hidden", "true");
      expect(
        container.querySelector('[aria-label="Comment on web_search"]'),
      ).toHaveAttribute("aria-hidden", "true");
    });
  });

  describe("when the pointer is on its row", () => {
    /** @scenario "A waterfall row's hidden actions take none of the name's room" */
    it("brings the pin and comment actions on screen", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const { container } = renderRow([]);

      await user.hover(rowOf(container));

      expect(
        container.querySelector('[aria-label="Pin span tab"]'),
      ).not.toHaveAttribute("aria-hidden", "true");
      expect(
        container.querySelector('[aria-label="Comment on web_search"]'),
      ).not.toHaveAttribute("aria-hidden", "true");
    });
  });
});

describe("given a row that carries a mark of its own", () => {
  /** @scenario "A waterfall row's hidden actions take none of the name's room" */
  it("keeps a pinned span's mark visible and roomed", () => {
    const { container } = renderRow([], { isPinned: true });

    expect(actionCluster()).toHaveAttribute("data-roomed", "true");
    expect(
      container.querySelector('[aria-label="Unpin span tab"]'),
    ).not.toHaveAttribute("aria-hidden", "true");
  });

  /** @scenario "A waterfall row's hidden actions take none of the name's room" */
  it("keeps a commented span's count visible and roomed", () => {
    const { container } = renderRow([comment()]);

    expect(actionCluster()).toHaveAttribute("data-roomed", "true");
    expect(
      container.querySelector('[aria-label="1 comment on web_search"]'),
    ).not.toHaveAttribute("aria-hidden", "true");
  });
});

describe("when the reader may read annotations but not write them", () => {
  beforeEach(() => {
    mocks.canManage = false;
  });

  /** @scenario "A reviewer who may only read annotations is offered no comment action" */
  it("offers no comment action on a span with nothing said about it", () => {
    const { container } = renderRow([]);

    expect(
      container.querySelector('[aria-label="Comment on web_search"]'),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A reviewer who may only read annotations is offered no comment action" */
  it("still reads the comments already left on the span", async () => {
    renderRow([comment()]);

    fireEvent.click(
      screen.getByRole("button", { name: "1 comment on web_search" }),
    );

    expect(
      await screen.findByText("this search returned nothing"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Add annotation")).not.toBeInTheDocument();
  });
});
