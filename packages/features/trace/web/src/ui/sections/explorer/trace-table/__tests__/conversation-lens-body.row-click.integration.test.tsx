/**
 * @vitest-environment jsdom
 *
 * What a click does on a conversation row: the row opens the conversation's
 * most recent trace in the drawer, and the chevron is the one affordance that
 * expands its turns inline.
 *
 * @see specs/traces-v2/sessions-lens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { LensConfig } from "../../../../../index";
import { useDrawerStore } from "../../../../../index";
import {
  mapSessionGroupToConversationGroup,
  type SessionGroupPayloadItem,
} from "../../utils/map-session-groups-payload";
import { ConversationLensBody } from "../conversation-lens-body";
import type { ConversationGroup } from "../conversation-groups";
import { setTraceTableScrollElement } from "../../../../../behavior/explorer/trace-table/scroll-context";

const { openDrawerMock } = vi.hoisted(() => ({ openDrawerMock: vi.fn() }));

vi.mock("../../../../../behavior/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock }),
}));

// The expanded row's turns come from their own conversation-scoped query;
// nothing here needs them to land, only whether the row asked to expand.
vi.mock("../../hooks/use-conversation-turns", () => ({
  useConversationTurns: () => ({ data: undefined }),
}));

const LAST_ACTIVITY_MS = 1_700_003_600_000;

function conversationRow(overrides: Partial<SessionGroupPayloadItem> = {}): ConversationGroup {
  return mapSessionGroupToConversationGroup({
    conversationId: "conv-1",
    traceCount: 4,
    totalCost: 1.5,
    totalTokens: 90_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextSizeTokens: 40_000,
    totalDurationMs: 12_000,
    startedAtMs: LAST_ACTIVITY_MS - 600_000,
    lastActivityMs: LAST_ACTIVITY_MS,
    models: ["claude-sonnet-4"],
    primaryModel: "claude-sonnet-4",
    serviceName: "coding-agent-cli",
    errorCount: 0,
    warningCount: 0,
    totalSpans: 900,
    lastTraceId: "trace-latest",
    input: "make the tests pass",
    output: "all green",
    codingAgent: null,
    ...overrides,
  });
}

const lens: LensConfig = {
  id: "conversations",
  name: "Conversations",
  isBuiltIn: true,
  columns: ["conversation", "turns"],
  addons: ["conversation-turns"],
  grouping: "by-conversation",
  sort: { columnId: "lastTurn", direction: "desc" },
  filterText: "",
};

function renderBody(groups: ConversationGroup[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationLensBody groups={groups} lens={lens} />
    </ChakraProvider>,
  );
}

/** The main row of the first conversation, the surface a reader clicks. */
function firstRow(): HTMLElement {
  const row = document.querySelector("tbody tr");
  if (!row) throw new Error("no conversation row rendered");
  return row as HTMLElement;
}

const expandToggle = () => screen.getByRole("button", { name: /Expand turns|Collapse turns/ });

beforeEach(() => {
  openDrawerMock.mockClear();
  useDrawerStore.getState().closeDrawer();
  // The virtualizer windows rows to the scroll element's height, and jsdom
  // measures every element as zero, which windows the table down to no rows
  // at all and leaves every assertion below passing vacuously. Publishing a
  // scroll element that reports a real height is what puts rows on screen.
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

describe("given the conversations lens is showing grouped rows", () => {
  describe("when the reader clicks a conversation row", () => {
    /** @scenario Clicking a conversation opens its latest trace in the drawer */
    it("opens the drawer on the conversation's most recent trace, without expanding the row", async () => {
      const user = userEvent.setup();
      renderBody([conversationRow()]);

      await user.click(firstRow());

      expect(openDrawerMock).toHaveBeenCalledWith("traceV2Details", {
        traceId: "trace-latest",
        t: String(LAST_ACTIVITY_MS),
      });
      // The drawer's own hooks read the trace off the store, so the row has to
      // push it there as well as into the URL.
      expect(useDrawerStore.getState().traceId).toBe("trace-latest");
      expect(useDrawerStore.getState().occurredAtMs).toBe(LAST_ACTIVITY_MS);
      expect(expandToggle()).toHaveAccessibleName("Expand turns");
    });
  });

  describe("when the reader clicks the row's expand chevron", () => {
    /** @scenario The chevron alone expands a conversation inline */
    it("expands the conversation and leaves the drawer closed", async () => {
      const user = userEvent.setup();
      renderBody([conversationRow()]);

      await user.click(expandToggle());

      expect(expandToggle()).toHaveAccessibleName("Collapse turns");
      expect(openDrawerMock).not.toHaveBeenCalled();
      expect(useDrawerStore.getState().isOpen).toBe(false);
    });
  });

  describe("when the read named no trace for a conversation", () => {
    // Only client-grouped rows (onboarding sample preview) and skeletons get
    // here; expanding keeps the row useful rather than making it dead surface.
    it("expands on click instead of opening an absent trace", async () => {
      const user = userEvent.setup();
      renderBody([conversationRow({ lastTraceId: null })]);

      await user.click(firstRow());

      expect(openDrawerMock).not.toHaveBeenCalled();
      expect(expandToggle()).toHaveAccessibleName("Collapse turns");
    });
  });
});
