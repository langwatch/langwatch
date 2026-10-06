/**
 * @vitest-environment jsdom
 *
 * The turn rows an expanded conversation shows, and the pauses between them.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { setTraceTableScrollElement } from "../../../../../behavior/explorer/trace-table/scroll-context.ts";
import type { LensConfig } from "../../../../../behavior/view.slice.ts";
import type { TraceListItem } from "../../types/trace.ts";
import { mapSessionGroupToConversationGroup } from "../../utils/map-session-groups-payload.ts";
import { ConversationLensBody } from "../conversation-lens-body.tsx";
import { buildTracePlaceholderRows } from "../skeleton-placeholders.ts";

const harness = vi.hoisted(() => ({ turns: [] as unknown[] }));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), currentDrawer: null, closeDrawer: vi.fn() }),
  useDrawerParams: () => ({}),
}));
vi.mock("../../hooks/use-open-trace-drawer.ts", () => ({ useOpenTraceDrawer: () => vi.fn() }));
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

async function expandConversation() {
  const group = mapSessionGroupToConversationGroup({
    conversationId: "conv-1",
    traceCount: harness.turns.length,
    totalCost: 0.5,
    totalTokens: 900,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextSizeTokens: 0,
    totalDurationMs: 3000,
    startedAtMs: START_MS,
    lastActivityMs: START_MS + 120_000,
    models: ["gpt-5-mini"],
    primaryModel: "gpt-5-mini",
    serviceName: "support",
    errorCount: 0,
    warningCount: 0,
    totalSpans: 9,
    lastTraceId: "t3",
    input: "hi",
    output: "hello",
    codingAgent: null,
  });
  renderWithDesignSystem(<ConversationLensBody groups={[group]} lens={lens} />);
  await userEvent.click(screen.getByRole("button", { name: "Expand turns" }));
}

beforeEach(() => {
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

describe("an expanded conversation", () => {
  /** @scenario "Expanding a conversation shows turn rows" */
  it("lists each turn with its number, user and assistant message, duration and the time between turns", async () => {
    harness.turns = [
      turn({ traceId: "t1", timestamp: START_MS, input: "where is my order", output: "shipped" }),
      turn({ traceId: "t2", timestamp: START_MS + 6000, input: "when", output: "tomorrow" }),
      turn({ traceId: "t3", timestamp: START_MS + 12_000, input: "thanks", output: "welcome" }),
    ];
    await expandConversation();

    expect(screen.getAllByText("5.0s")).toHaveLength(2);
    for (const [index, input, output] of [
      [1, "where is my order", "shipped"],
      [2, "when", "tomorrow"],
      [3, "thanks", "welcome"],
    ] as const) {
      const row = screen.getAllByText(input).at(-1)?.closest("tr") as HTMLElement;
      expect(row).toHaveTextContent(new RegExp(`Turn\\s*${index}\\s*·\\s*1\\.0s`));
      expect(within(row).getAllByText(input).length).toBeGreaterThan(0);
      expect(within(row).getAllByText(output).length).toBeGreaterThan(0);
      expect(row).toHaveTextContent("User");
      expect(row).toHaveTextContent("Assistant");
    }
  });

  /** @scenario "Long pauses between turns are highlighted" */
  it("marks a gap over 30 seconds as a pause and leaves a short gap unmarked", async () => {
    harness.turns = [
      turn({ traceId: "t1", timestamp: START_MS, input: "a", output: "b" }),
      turn({ traceId: "t2", timestamp: START_MS + 1000 + 12_400, input: "c", output: "d" }),
      turn({
        traceId: "t3",
        timestamp: START_MS + 2000 + 12_400 + 45_000,
        input: "e",
        output: "f",
      }),
    ];
    await expandConversation();

    expect(screen.getByText("12.4s")).toBeInTheDocument();
    expect(screen.getByText("45.0s pause")).toBeInTheDocument();
    expect(screen.queryByText("12.4s pause")).toBeNull();
  });
});
