/**
 * @vitest-environment jsdom
 *
 * Clicking one turn of an expanded conversation opens that trace's drawer.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { setTraceTableScrollElement } from "../../../../../behavior/explorer/trace-table/scroll-context.ts";
import type { LensConfig } from "../../../../../behavior/view.slice.ts";
import { DEFAULT_VIEW_MODE } from "../../../../../model/trace-drawer-params.ts";
import { ModeSwitch } from "../../trace-drawer/mode-switch.tsx";
import type { TraceListItem } from "../../types/trace.ts";
import { mapSessionGroupToConversationGroup } from "../../utils/map-session-groups-payload.ts";
import { ConversationLensBody } from "../conversation-lens-body.tsx";
import { buildTracePlaceholderRows } from "../skeleton-placeholders.ts";

const harness = vi.hoisted(() => ({ turns: [] as unknown[], openDrawer: vi.fn() }));

vi.mock("../../../../../behavior/trace-api.ts", () => {
  const procedure = () => ({ setData: vi.fn(), prefetch: vi.fn() });
  const names = [
    "header",
    "spanTree",
    "spansFull",
    "spanDetail",
    "spanLangwatchSignals",
    "traceEvents",
    "evals",
    "conversationContext",
    "resourceInfo",
  ];
  const traces = Object.fromEntries(names.map((name) => [name, procedure()]));
  return { api: { useUtils: () => ({ traces }) } };
});
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));
vi.mock("../../hooks/span-tree-paged-query.ts", () => ({
  spanTreeQueryKey: (input: unknown) => ["spanTree", input],
  spanTreeQueryFn: () => () => undefined,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useQueryClient: () => ({ prefetchQuery: vi.fn() }),
}));
vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({
    openDrawer: harness.openDrawer,
    currentDrawer: null,
    closeDrawer: vi.fn(),
  }),
  useDrawerParams: () => ({}),
}));
vi.mock("../../hooks/use-conversation-turns.ts", () => ({
  useConversationTurns: () => ({ data: harness.turns }),
}));
vi.mock("../../utils/map-trace-list-payload.ts", () => ({
  mapTraceListPayload: (data: unknown[] | undefined) => data ?? [],
}));
vi.mock("../../trace-id-peek.tsx", () => ({ TraceIdPeek: () => null }));

const START_MS = 1_700_000_000_000;

const lens: LensConfig = {
  id: "conversations",
  name: "Conversations",
  isBuiltIn: true,
  columns: ["conversation", "turns", "duration"],
  addons: ["conversation-turns"],
  grouping: "by-conversation",
  sort: { columnId: "lastTurn", direction: "desc" },
  filterText: "",
};

function turn(over: Partial<TraceListItem> & { traceId: string }): TraceListItem {
  const [placeholder] = buildTracePlaceholderRows(1);
  if (!placeholder) throw new Error("no placeholder row built");
  return { ...placeholder, durationMs: 1000, status: "ok", ...over };
}

beforeEach(() => {
  harness.openDrawer.mockClear();
  useExplorerStore.getState().setExpandedRows([]);
  const scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "offsetHeight", { value: 800 });
  Object.defineProperty(scrollElement, "offsetWidth", { value: 1200 });
  document.body.appendChild(scrollElement);
  setTraceTableScrollElement(scrollElement);
});

afterEach(() => {
  cleanup();
  setTraceTableScrollElement(null);
});

describe("given an expanded conversation with two turns", () => {
  describe("when the reader clicks the second turn", () => {
    /** @scenario Clicking a turn row opens the trace drawer */
    it("opens the trace drawer for that trace, not the conversation, and the drawer offers the Conversation tab", async () => {
      harness.turns = [
        turn({ traceId: "t1", timestamp: START_MS, input: "first question", output: "one" }),
        turn({
          traceId: "t2",
          timestamp: START_MS + 6000,
          input: "second question",
          output: "two",
        }),
      ];
      const group = mapSessionGroupToConversationGroup({
        conversationId: "conv-1",
        traceCount: 2,
        totalCost: 0.5,
        totalTokens: 900,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextSizeTokens: 0,
        totalDurationMs: 2000,
        startedAtMs: START_MS,
        lastActivityMs: START_MS + 6000,
        models: ["gpt-5-mini"],
        primaryModel: "gpt-5-mini",
        serviceName: "support",
        errorCount: 0,
        warningCount: 0,
        totalSpans: 4,
        lastTraceId: "t2",
        input: "hi",
        output: "hello",
        codingAgent: null,
      });
      const user = userEvent.setup();
      renderWithDesignSystem(<ConversationLensBody groups={[group]} lens={lens} />);
      await user.click(screen.getByRole("button", { name: "Expand turns" }));
      harness.openDrawer.mockClear();

      await user.click(screen.getAllByText("second question").at(-1) as HTMLElement);

      expect(harness.openDrawer).toHaveBeenCalledTimes(1);
      expect(harness.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: "t2",
        t: String(START_MS + 6000),
      });
      expect(DEFAULT_VIEW_MODE).not.toBe("conversation");

      cleanup();
      renderWithDesignSystem(
        <ModeSwitch viewMode={DEFAULT_VIEW_MODE} onViewModeChange={vi.fn()} hasConversation />,
      );
      expect(screen.getByText("Conversation")).toBeVisible();
    });
  });
});
