/**
 * @vitest-environment jsdom
 *
 * The per-turn separator ledger is decluttered: the cryptic model
 * abbreviation and the raw input→output token count are gone and the relative
 * time carries an explicit "ago". The "Xs gap" divider between turns is kept —
 * a long pause since the previous turn is worth surfacing. See
 * specs/traces-v2/conversation-turn-ledger.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../scenario-roles", async () => {
  const actual =
    await vi.importActual<typeof import("../../scenario-roles")>("../../scenario-roles");
  return { ...actual, useIsScenarioRole: () => false };
});

vi.mock(
  "../../../../../../behavior/explorer/trace-drawer/conversation-view/expand-context",
  () => ({
    useConversationExpand: () => ({
      isExpandable: false,
      shouldExpandAll: false,
    }),
    ConversationExpandContext: {
      Provider: ({ children }: { children: unknown }) => children,
    },
  }),
);

vi.mock("../../../hooks/use-text-translation", () => ({
  useTextTranslation: ({ texts }: { texts: Record<string, string> }) => ({
    displayTexts: texts,
    isActive: false,
    isLoading: false,
    toggle: () => undefined,
  }),
}));

/**
 * The badge stands in as an empty marker: the tests read the ledger's text, so
 * anything with words of its own would show up in those assertions.
 */
vi.mock("../turn-annotations", () => ({
  TurnEditTraceAction: () => <div data-testid="turn-edit-trace-action" />,
  TurnSessionCheckbox: () => <div data-testid="turn-session-checkbox" />,
  TurnAnnotationBadges: () => <div data-testid="turn-annotation-badges" />,
}));

vi.mock("../../../../markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("../../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

import type { TraceListItem } from "../../../types/trace";
import { NO_TRACE_EVENTS } from "../../../types/trace";
import { ChatTurnRow } from "../chat-turn-row";

const ONE_HOUR_MS = 60 * 60 * 1000;

function turn(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 1,
    name: "turn",
    serviceName: "svc",
    durationMs: 10,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    sizeBytes: 0,
    input: null,
    output: null,
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
    ...over,
  };
}

function events(count: number): TraceListItem["events"] {
  if (count === 0) return NO_TRACE_EVENTS;
  return {
    groups: [{ name: "thumbs_up", count, firstTimestamp: 1 }],
    totalCount: count,
    distinctCount: 1,
  };
}

function renderRow({
  gap,
  eventCount = 0,
}: {
  gap?: { gapSecs: number; showGap: boolean };
  eventCount?: number;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChatTurnRow
        layout="thread"
        turn={turn({
          durationMs: 20900,
          totalTokens: 5038,
          inputTokens: 4500,
          outputTokens: 538,
          models: ["openai/gpt-4o"],
          timestamp: Date.now() - ONE_HOUR_MS,
          events: events(eventCount),
        })}
        userText="a question"
        assistantText="an answer"
        assistantReasoning=""
        gapSecs={gap?.gapSecs ?? 0}
        showGap={gap?.showGap ?? false}
        index={3}
        isCurrent={false}
        onSelect={() => undefined}
      />
    </ChakraProvider>,
  );
}

/** The separator row is the group wrapping the "Turn N" label. */
function separatorRow(): HTMLElement {
  return screen.getByText("Turn 3").closest('[role="group"]') as HTMLElement;
}

function separatorText(): string {
  return separatorRow()?.textContent ?? "";
}

afterEach(cleanup);

describe("ChatTurnRow separator ledger", () => {
  describe("given a turn with a model, tokens and an hour-old timestamp", () => {
    it("keeps duration and shows relative time with an ago suffix", () => {
      renderRow();
      const text = separatorText();
      expect(text).toContain("20.9s");
      expect(text).toContain("1h ago");
    });

    it("drops the model abbreviation from the ledger", () => {
      renderRow();
      expect(separatorText()).not.toMatch(/gpt/i);
    });

    it("drops the input→output token count", () => {
      renderRow();
      const text = separatorText();
      expect(text).not.toContain("→");
      expect(text).not.toContain("4.5K");
    });
  });

  describe("given a turn preceded by a long pause", () => {
    it("renders the inter-turn gap divider", () => {
      const { container } = renderRow({
        gap: { gapSecs: 12.5, showGap: true },
      });
      expect(container.textContent ?? "").toMatch(/12\.5s gap/);
    });
  });

  describe("given the first turn, with no preceding pause", () => {
    it("does not render a gap divider", () => {
      const { container } = renderRow({ gap: { gapSecs: 0, showGap: false } });
      expect(container.textContent ?? "").not.toMatch(/gap/i);
    });
  });

  describe("given a turn that recorded events", () => {
    /** @scenario "A turn with events shows how many it recorded" */
    it("counts them in the ledger", () => {
      renderRow({ eventCount: 2 });
      expect(separatorText()).toContain("2 events");
    });

    /** @scenario "A single event reads in the singular" */
    it("reads a single event in the singular", () => {
      renderRow({ eventCount: 1 });
      const text = separatorText();
      expect(text).toContain("1 event");
      expect(text).not.toContain("1 events");
    });
  });

  describe("given a turn that recorded no events", () => {
    /** @scenario "A turn with no events shows no events segment" */
    it("says nothing about events", () => {
      renderRow({ eventCount: 0 });
      expect(separatorText()).not.toMatch(/event/i);
    });
  });

  describe("given a turn that carries an annotation", () => {
    /** @scenario "The annotation badge takes its own room on the separator" */
    it("puts the badge in the separator row rather than over it", () => {
      renderRow();

      const separator = separatorRow();
      const badgeSlot = screen.getByTestId("turn-annotation-badges").parentElement!;

      // In flow: the slot holding the badge is a child of the separator, so the
      // badge takes its own room instead of being drawn over the ledger.
      expect(badgeSlot.parentElement).toBe(separator);
      expect(getComputedStyle(badgeSlot).position).not.toBe("absolute");
    });

    /** @scenario "The annotation badge takes its own room on the separator" */
    it("keeps the hover actions floating over the end of the line", () => {
      renderRow();

      const floating = screen.getByTestId("turn-edit-trace-action").parentElement!;

      expect(floating).not.toBe(separatorRow());
      expect(getComputedStyle(floating).position).toBe("absolute");
    });

    // A hidden action row is still a click target. Anchored to the separator's
    // own edge it lay across the badge, and clicking the badge activated the
    // action under it instead of opening the annotation list.
    /** @scenario "The annotation badge takes its own room on the separator" */
    it("floats the hover actions clear of the badge, not across it", () => {
      renderRow();

      const badgeSlot = screen.getByTestId("turn-annotation-badges").parentElement!;
      const floating = screen.getByTestId("turn-edit-trace-action").parentElement!;

      // Anchored to the badge's own slot, and past its far edge, so no part of
      // the action row can ever sit on top of the badge.
      expect(floating.parentElement).toBe(badgeSlot);
      expect(getComputedStyle(badgeSlot).position).toBe("relative");
      expect(getComputedStyle(floating).right).toBe("100%");
    });
  });
});
