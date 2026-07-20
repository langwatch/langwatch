/**
 * @vitest-environment jsdom
 *
 * The per-turn separator ledger was decluttered: the cryptic model
 * abbreviation and the raw input→output token count are gone, the relative
 * time carries an explicit "ago", and the "Xs gap" divider between turns is
 * removed. See specs/traces-v2/conversation-turn-ledger.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../scenarioRoles", async () => {
  const actual = await vi.importActual<typeof import("../../scenarioRoles")>(
    "../../scenarioRoles",
  );
  return { ...actual, useIsScenarioRole: () => false };
});

vi.mock("../expandContext", () => ({
  useConversationExpand: () => ({
    isExpandable: false,
    shouldExpandAll: false,
  }),
  ConversationExpandContext: {
    Provider: ({ children }: { children: unknown }) => children,
  },
}));

vi.mock("../../../../hooks/useTextTranslation", () => ({
  useTextTranslation: ({ texts }: { texts: Record<string, string> }) => ({
    displayTexts: texts,
    isActive: false,
    isLoading: false,
    toggle: () => undefined,
  }),
}));

vi.mock("../TurnAnnotations", () => ({
  TurnActionRow: () => null,
  TurnAnnotationBadges: () => null,
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

import type { TraceListItem } from "../../../../types/trace";
import { ChatTurnRow } from "../ChatTurnRow";

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
    events: [],
    ...over,
  };
}

function renderRow() {
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
        })}
        userText="a question"
        assistantText="an answer"
        assistantReasoning=""
        index={3}
        isCurrent={false}
        onSelect={() => undefined}
      />
    </ChakraProvider>,
  );
}

/** The ledger row is the group wrapping the "Turn N" label. */
function separatorText(): string {
  const label = screen.getByText("Turn 3");
  const group = label.closest('[role="group"]');
  return group?.textContent ?? "";
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

  describe("given consecutive turns", () => {
    it("never renders an inter-turn gap divider", () => {
      const { container } = renderRow();
      expect(container.textContent ?? "").not.toMatch(/gap/i);
    });
  });
});
