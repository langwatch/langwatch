// A user message that opens with an agent's injected context block (Copilot's
// `<current_datetime>`) reads with the user's own words; the block is folded.
// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../../../../behavior/trace-host.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTraceHost: () => ({ hasPermission: () => false }),
}));
vi.mock("../../../../../../features/trace-drawer/behavior/scenario-role.store.tsx", async () => {
  const actual = await vi.importActual<typeof scenarioRolesModule>(
    "../../../../../../features/trace-drawer/behavior/scenario-role.store.tsx",
  );
  return { ...actual, useIsScenarioRole: () => false };
});

vi.mock("@langwatch/design-system/conversation-expand-context", async () => {
  const actual = await vi.importActual<typeof actualModule>(
    "@langwatch/design-system/conversation-expand-context",
  );
  return {
    ...actual,
    useConversationExpand: () => ({ isExpandable: false, shouldExpandAll: false }),
    ConversationExpandContext: {
      Provider: ({ children }: { children: unknown }) => children,
    },
  };
});

vi.mock("../../../../../../features/trace-drawer/behavior/use-text-translation.ts", () => ({
  useTextTranslation: ({ texts }: { texts: Record<string, string> }) => ({
    displayTexts: texts,
    isActive: false,
    isLoading: false,
    toggle: () => undefined,
  }),
}));

vi.mock("../turn-annotations.tsx", () => ({
  TurnEditTraceAction: () => null,
  TurnSessionCheckbox: () => null,
  TurnAnnotationBadges: () => null,
}));

vi.mock("../../../../markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <span data-testid="message-markdown">{children}</span>
  ),
}));

import type * as actualModule from "@langwatch/design-system/conversation-expand-context";

import type { TraceListItem } from "../../../../../../behavior/explorer/types/trace.ts";
import { NO_TRACE_EVENTS } from "../../../../../../behavior/explorer/types/trace.ts";
import type * as scenarioRolesModule from "../../../../../../features/trace-drawer/behavior/scenario-role.store.tsx";
import { ChatTurnRow } from "../chat-turn-row.tsx";

const copilotTurn: TraceListItem = {
  traceId: "t1",
  timestamp: 1,
  name: "invoke_agent",
  serviceName: "copilot-cli",
  durationMs: 10,
  totalCost: 0,
  nonBilledCost: 0,
  totalTokens: 0,
  models: ["gpt-6-luna"],
  labels: [],
  status: "ok",
  spanCount: 1,
  sizeBytes: 0,
  input: null,
  output: null,
  origin: "coding_agent",
  evaluations: [],
  events: NO_TRACE_EVENTS,
};

const PROMPT = "Count the files in this folder using ls, and reply with just the number.";
const DATE_BLOCK = "<current_datetime>2026-10-21T19:50:21.761+02:00</current_datetime>";

function renderRow(userText: string) {
  return renderWithDesignSystem(
    <ChatTurnRow
      layout="thread"
      turn={copilotTurn}
      userText={userText}
      assistantText="3"
      assistantReasoning=""
      gapSecs={0}
      shouldShowGap={false}
      index={1}
      isCurrent={false}
      onSelect={() => undefined}
    />,
  );
}

describe("<ChatTurnRow/> a user message that opens with an injected context block", () => {
  afterEach(cleanup);

  /** @scenario "A Copilot prompt in the Conversation tab opens with the user's own words" */
  it("shows the prompt's own words and folds the date block away", () => {
    renderRow(`${DATE_BLOCK}\n\n${PROMPT}`);

    const messages = screen.getAllByTestId("message-markdown").map((node) => node.textContent);
    expect(messages).toContain(PROMPT);
    expect(messages.join("\n")).not.toContain("<current_datetime>");
    expect(screen.getByRole("button", { name: /hidden additional context/i })).toBeInTheDocument();
  });

  it("leaves a message that is only a context block as it was written", () => {
    renderRow(DATE_BLOCK);

    const messages = screen.getAllByTestId("message-markdown").map((node) => node.textContent);
    expect(messages).toContain(DATE_BLOCK);
    expect(screen.queryByRole("button", { name: /hidden additional context/i })).toBeNull();
  });
});
