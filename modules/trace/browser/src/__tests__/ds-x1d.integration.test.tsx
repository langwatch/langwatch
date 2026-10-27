/**
 * @vitest-environment jsdom
 * Keyboard and relationships of the two hand-built trace tab strips: the saved-lens tabs (the
 * tab machine drives them through the context-menu trigger) and the span strip with its details
 * panel, driven by the real drawer address and the real drawer shortcut hook.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { type SpanTreeNode, type TraceHeader, traceHeaderSchema } from "@langwatch/trace-contract";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useDrawerChrome } from "../behavior/drawer-chrome.store.ts";
import { useExplorerStore } from "../behavior/explorer.store.ts";
import { useTraceDrawer } from "../behavior/trace-drawer.ts";
import type { ConversationContextResult } from "../features/conversation/behavior/use-conversation-context.ts";
import { useTraceDrawerShortcuts } from "../features/trace-drawer/behavior/use-trace-drawer-shortcuts.ts";
import { LensTabs } from "../ui/sections/explorer/toolbar/lens-tabs.tsx";
import { SpanDetailPane } from "../ui/sections/explorer/trace-drawer/panes/span-detail-pane.tsx";

const prefetchSpan = vi.hoisted(() => vi.fn());
vi.mock("../features/span/behavior/use-prefetch-span-detail.ts", () => ({
  usePrefetchSpanDetail: () => prefetchSpan,
}));
vi.mock("../ui/sections/explorer/hooks/use-error-count.ts", () => ({ useErrorCount: () => 0 }));
vi.mock("../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", kind: "application" },
    hasPermission: () => true,
  }),
}));
vi.mock("../ui/sections/explorer/trace-drawer/trace-accordions/index.ts", () => ({
  TraceAccordions: ({ selectedSpanId }: { selectedSpanId: string | null }) => (
    <div data-testid="accordions">{`Details of ${selectedSpanId}`}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function span({ spanId, name }: { spanId: string; name: string }): SpanTreeNode {
  return {
    spanId,
    parentSpanId: null,
    name,
    type: "llm",
    startTimeMs: 0,
    endTimeMs: 10,
    durationMs: 10,
    status: "ok",
    model: null,
  };
}

const SPANS: SpanTreeNode[] = ["s1", "s2", "s3", "s4", "s5"].map((spanId, index) =>
  span({ spanId, name: ["plan", "search", "answer", "verify", "report"][index] ?? spanId }),
);

const TRACE: TraceHeader = traceHeaderSchema.parse({
  traceId: "t1",
  timestamp: 1_700_000_000_000,
  name: "root",
  serviceName: "svc",
  origin: "sdk",
  conversationId: "c1",
  userId: null,
  durationMs: 120,
  spanCount: 5,
  status: "ok",
  models: [],
  totalCost: 0,
  totalTokens: 0,
  inputTokens: null,
  outputTokens: null,
  tokensEstimated: false,
  traceName: "root",
  rootSpanType: null,
  scenarioRunId: null,
  attributes: {},
});

const CONVERSATION: ConversationContextResult = {
  conversationId: "c1",
  total: 3,
  position: 1,
  turns: [],
  previous: null,
  next: {
    traceId: "t2",
    timestamp: 1_700_000_001_000,
    name: "next",
    rootSpanType: null,
    status: "ok",
    input: null,
    output: null,
  },
  isLoading: false,
};

function addressOf({ span: selected, pinned }: { span: string | null; pinned: string[] }) {
  const params = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": TRACE.traceId,
  });
  if (selected) params.set("drawer.span", selected);
  if (pinned.length > 0) params.set("drawer.pinnedSpans", pinned.join(","));
  return `/p/traces?${params.toString()}`;
}

function Drawer({
  spans = SPANS,
  trace = TRACE,
  navigateToTrace,
}: {
  spans?: SpanTreeNode[];
  trace?: TraceHeader;
  navigateToTrace: () => void;
}) {
  const selectedSpanId = useTraceDrawer((s) => s.selectedSpanId);
  useTraceDrawerShortcuts({
    trace,
    spanTree: spans,
    conversationContext: CONVERSATION,
    navigateToTrace,
    goBack: vi.fn(),
    canGoBack: false,
    refreshActiveTrace: vi.fn(),
    onClose: vi.fn(),
  });
  return (
    <SpanDetailPane
      trace={trace}
      spans={spans}
      selectedSpan={spans.find((s) => s.spanId === selectedSpanId) ?? null}
      layout="vertical"
    />
  );
}

/** Counts the navigations the strip's buttons cause: each lands a new location key. */
const navigations: string[] = [];
function LocationProbe() {
  const location = useLocation();
  if (navigations.at(-1) !== location.key) navigations.push(location.key);
  return null;
}

function renderDrawer({
  selected,
  pinned,
  navigateToTrace = vi.fn(),
  beside,
}: {
  selected: string | null;
  pinned: string[];
  navigateToTrace?: () => void;
  beside?: React.ReactNode;
}) {
  navigations.length = 0;
  return renderWithDesignSystem(
    <MemoryRouter initialEntries={[addressOf({ span: selected, pinned })]}>
      <LocationProbe />
      {beside}
      <Drawer navigateToTrace={navigateToTrace} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  act(() => useDrawerChrome.getState().expandSpanDetail());
});

describe("SpanTabBar in the span detail pane", () => {
  describe("when three spans are pinned and the second is open", () => {
    it("is a labelled tablist of native tab buttons with one tab stop on the open tab", () => {
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });

      const tablist = screen.getByRole("tablist", { name: "Open spans" });
      const tabs = within(tablist).getAllByRole("tab");
      expect(tabs.map((tab) => tab.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
        "false",
        "true",
        "false",
      ]);
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
      expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
        "plan",
        "search",
        "answer",
      ]);
      for (const tab of tabs) expect(within(tab).queryAllByRole("button")).toHaveLength(0);
      for (const button of screen.getAllByRole("button", { name: "Unpin span tab" })) {
        expect(button).toHaveAttribute("type", "button");
      }
    });

    it("links the open tab and the pane's scroll body both ways", () => {
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });

      const open = screen.getByRole("tab", { name: "search" });
      const panel = screen.getByRole("tabpanel", { name: "search" });
      expect(open.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel.getAttribute("aria-labelledby")).toBe(open.id);
      expect(within(panel).getByTestId("accordions")).toHaveTextContent("Details of s2");
      expect(screen.getByRole("tab", { name: "plan" })).not.toHaveAttribute("aria-controls");
    });
  });

  describe("when the details are collapsed and opened again", () => {
    it("keeps the panel as the tab's target and mounts the accordions only while open", () => {
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });
      const open = screen.getByRole("tab", { name: "search" });
      const panelId = open.getAttribute("aria-controls") ?? "";

      act(() => useDrawerChrome.getState().togglePaneCollapsed("spanDetail"));
      const collapsed = document.getElementById(panelId);
      expect(collapsed).not.toBeNull();
      expect(collapsed).toHaveAttribute("hidden");
      expect(screen.queryByTestId("accordions")).not.toBeInTheDocument();

      act(() => useDrawerChrome.getState().togglePaneCollapsed("spanDetail"));
      expect(document.getElementById(panelId)).not.toHaveAttribute("hidden");
      expect(screen.getByTestId("accordions")).toBeInTheDocument();
    });
  });

  describe("when the open span is folded into the +N more menu", () => {
    it("has no tab for it and names the panel from the span instead of a missing tab", () => {
      renderDrawer({ selected: "s5", pinned: ["s1", "s2", "s3", "s4", "s5"] });

      expect(screen.getAllByRole("tab")).toHaveLength(3);
      for (const tab of screen.getAllByRole("tab")) {
        expect(tab).not.toHaveAttribute("aria-controls");
        expect(tab).toHaveAttribute("aria-selected", "false");
      }
      const panel = screen.getByRole("tabpanel", { name: "report" });
      expect(panel).not.toHaveAttribute("aria-labelledby");
      expect(screen.getByTestId("accordions")).toHaveTextContent("Details of s5");
    });
  });

  describe("when the selected span is not in the tree", () => {
    it("still names the panel and links no tab", () => {
      renderDrawer({ selected: "gone", pinned: ["s1"] });

      expect(screen.getByRole("tabpanel", { name: "Span details" })).not.toHaveAttribute(
        "aria-labelledby",
      );
      expect(screen.getByRole("tab", { name: "plan" })).not.toHaveAttribute("aria-controls");
    });
  });

  describe("when two panes stand side by side", () => {
    it("gives every tab and panel its own id", () => {
      renderWithDesignSystem(
        <MemoryRouter initialEntries={[addressOf({ span: "s2", pinned: ["s1", "s2", "s3"] })]}>
          <Drawer navigateToTrace={vi.fn()} />
          <Drawer navigateToTrace={vi.fn()} />
        </MemoryRouter>,
      );

      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
      expect(new Set(ids).size).toBe(ids.length);
      const panels = screen.getAllByRole("tabpanel");
      expect(panels).toHaveLength(2);
      for (const panel of panels) {
        const label = document.getElementById(panel.getAttribute("aria-labelledby") ?? "");
        expect(label?.getAttribute("aria-controls")).toBe(panel.id);
      }
    });
  });

  describe("when the reader moves to another trace in the same pane", () => {
    it("keeps the relationship on the new trace's spans", () => {
      const otherSpans = [span({ spanId: "s2", name: "second trace search" })];
      const { rerender } = renderDrawer({ selected: "s2", pinned: ["s2"] });
      const first = screen.getByRole("tabpanel").id;

      rerender(
        <MemoryRouter initialEntries={[addressOf({ span: "s2", pinned: ["s2"] })]}>
          <LocationProbe />
          {void 0}
          <Drawer
            spans={otherSpans}
            trace={{ ...TRACE, traceId: "t9" }}
            navigateToTrace={vi.fn()}
          />
        </MemoryRouter>,
      );

      const panel = screen.getByRole("tabpanel", { name: "second trace search" });
      expect(panel.id).toBe(first);
      expect(screen.getByRole("tab", { name: "second trace search" })).toHaveAttribute(
        "aria-controls",
        panel.id,
      );
    });
  });

  describe("when the reader uses the keyboard on a focused tab", () => {
    it("moves focus with the arrows, Home and End without opening a span or moving trace", async () => {
      const user = userEvent.setup();
      const navigateToTrace = vi.fn();
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"], navigateToTrace });
      const keys = navigations.length;

      screen.getByRole("tab", { name: "search" }).focus();
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("tab", { name: "answer" })).toHaveFocus();
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("tab", { name: "plan" })).toHaveFocus();
      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("tab", { name: "answer" })).toHaveFocus();
      await user.keyboard("{Home}");
      expect(screen.getByRole("tab", { name: "plan" })).toHaveFocus();
      await user.keyboard("{End}");
      expect(screen.getByRole("tab", { name: "answer" })).toHaveFocus();

      expect(navigateToTrace).not.toHaveBeenCalled();
      expect(navigations).toHaveLength(keys);
      expect(screen.getByRole("tab", { name: "search" })).toHaveAttribute("aria-selected", "true");
    });

    it("opens the focused span once on Enter and once on Space", async () => {
      const user = userEvent.setup();
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });
      const before = navigations.length;

      screen.getByRole("tab", { name: "plan" }).focus();
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "plan" })).toHaveAttribute("aria-selected", "true"),
      );
      expect(navigations.length - before).toBe(1);

      screen.getByRole("tab", { name: "answer" }).focus();
      await user.keyboard(" ");
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "answer" })).toHaveAttribute(
          "aria-selected",
          "true",
        ),
      );
      expect(navigations.length - before).toBe(2);
    });

    it("leaves Tab to carry focus on to the unpin button", async () => {
      const user = userEvent.setup();
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });

      screen.getByRole("tab", { name: "search" }).focus();
      await user.tab();

      expect(screen.getAllByRole("button", { name: "Unpin span tab" })[1]).toHaveFocus();
    });
  });

  describe("when the reader clicks with the mouse", () => {
    it("opens the span once and keeps the drawer's Left and Right on the conversation", async () => {
      const user = userEvent.setup();
      const navigateToTrace = vi.fn();
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"], navigateToTrace });
      const before = navigations.length;

      await user.click(screen.getByRole("tab", { name: "answer" }));
      await user.keyboard("{ArrowRight}");

      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "answer" })).toHaveAttribute(
          "aria-selected",
          "true",
        ),
      );
      expect(navigations.length - before).toBe(1);
      expect(screen.getByRole("tab", { name: "answer" })).not.toHaveFocus();
      expect(navigateToTrace).toHaveBeenCalledTimes(1);
      expect(navigateToTrace).toHaveBeenCalledWith(expect.objectContaining({ toTraceId: "t2" }));
    });

    it("releases a tab the keyboard was on, but never a field the reader is typing in", async () => {
      const user = userEvent.setup();
      const navigateToTrace = vi.fn();
      renderDrawer({
        selected: "s2",
        pinned: ["s1", "s2", "s3"],
        navigateToTrace,
        beside: <input aria-label="Find in trace" />,
      });

      screen.getByRole("tab", { name: "search" }).focus();
      await user.click(screen.getByRole("tab", { name: "answer" }));
      expect(document.activeElement).toBe(document.body);

      const find = screen.getByRole("textbox", { name: "Find in trace" });
      await user.click(find);
      await user.click(screen.getByRole("tab", { name: "plan" }));
      expect(find).toHaveFocus();
      await user.keyboard("{ArrowRight}");
      expect(navigateToTrace).not.toHaveBeenCalled();
    });

    it("does not take focus branch for a modified click", async () => {
      const user = userEvent.setup();
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });

      await user.keyboard("{Shift>}");
      await user.click(screen.getByRole("tab", { name: "answer" }));
      await user.keyboard("{/Shift}");

      expect(screen.getByRole("tab", { name: "answer" })).toHaveFocus();
    });

    it("unpins from the button once without opening the span", async () => {
      const user = userEvent.setup();
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });
      const before = navigations.length;

      await user.click(screen.getAllByRole("button", { name: "Unpin span tab" })[2]!);

      await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
      expect(navigations.length - before).toBe(1);
      expect(screen.getByRole("tab", { name: "search" })).toHaveAttribute("aria-selected", "true");
    });

    it("keeps one tab stop when the open tab is unpinned away", async () => {
      const user = userEvent.setup();
      renderDrawer({ selected: "s2", pinned: ["s1", "s2", "s3"] });

      await user.click(screen.getAllByRole("button", { name: "Unpin span tab" })[1]!);

      await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
      expect(screen.getAllByRole("tab").map((tab) => tab.tabIndex)).toEqual([0, -1]);
    });
  });
});

describe("LensTabs through the tab machine", () => {
  function renderLenses() {
    useExplorerStore.getState().selectLens("all-traces");
    return renderWithDesignSystem(<LensTabs />);
  }

  describe("when the lens strip shows its built-in lenses", () => {
    it("has one tab stop on the open lens, and every tab carries the list's ownership", () => {
      renderLenses();

      const tablist = screen.getByRole("tablist");
      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBeGreaterThan(2);
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
      expect(screen.getByRole("tab", { selected: true })).toHaveAttribute("tabindex", "0");
      for (const tab of tabs) {
        expect(tab.getAttribute("data-ownedby")).toBe(tablist.id);
        expect(tab.getAttribute("data-value")).toBe(tab.getAttribute("data-lens-slot"));
      }
    });

    it("moves focus with the arrows, Home and End, wrapping, and opens the focused lens on Enter", async () => {
      const user = userEvent.setup();
      renderLenses();
      const tabs = screen.getAllByRole("tab");
      const [first, second] = tabs;
      const last = tabs.at(-1);

      first?.focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(second).toHaveFocus());
      await user.keyboard("{End}");
      await waitFor(() => expect(last).toHaveFocus());
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(first).toHaveFocus());
      await user.keyboard("{ArrowLeft}");
      await waitFor(() => expect(last).toHaveFocus());
      await user.keyboard("{Home}");
      await waitFor(() => expect(first).toHaveFocus());
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(second).toHaveFocus());

      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(useExplorerStore.getState().activeLensId).toBe(second?.dataset.value),
      );
    });

    it("opens a lens context menu on right-click and returns focus to the tab on Escape", async () => {
      const user = userEvent.setup();
      renderLenses();
      const tab = screen.getAllByRole("tab")[1]!;

      await user.pointer({ keys: "[MouseRight]", target: tab });
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      expect(tab.id).not.toBe("");

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });
  });

  describe("when a saved lens is renamed in place", () => {
    it("keeps the arrow keys for the caret instead of moving between tabs", async () => {
      const user = userEvent.setup();
      renderLenses();
      await act(async () => {
        useExplorerStore.getState().createLens("mine");
      });
      const tab = await screen.findByRole("tab", { name: /mine/ });

      await user.pointer({ keys: "[MouseRight]", target: tab });
      await user.click(await screen.findByRole("menuitem", { name: /rename/i }));
      const input = await screen.findByRole("textbox");
      await user.type(input, "{ArrowLeft}{ArrowLeft}{Home}{End}");

      expect(input).toHaveFocus();
    });
  });
});
