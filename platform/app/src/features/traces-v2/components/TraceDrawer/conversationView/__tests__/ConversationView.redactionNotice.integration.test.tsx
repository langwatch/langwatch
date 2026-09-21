/**
 * @vitest-environment jsdom
 *
 * One redaction notice for the whole conversation: the policy that scrubbed a
 * turn is the project's, so the conversation says so once, above the turns,
 * with the link to the setting behind it. See
 * specs/traces-v2/conversation-redaction-notice.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const turns: TraceListItem[] = [];

vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({ data: { items: turns }, isLoading: false }),
}));

vi.mock("../../../../hooks/useConversationAnnotations", () => ({
  useConversationAnnotations: () => ({
    byTrace: new Map(),
    byAnchor: new Map(),
    all: [],
    hasAny: false,
    isLoading: false,
  }),
}));

vi.mock("../../../../hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

vi.mock("../../../../hooks/useConversationTurnEvents", () => ({
  useConversationTurnEvents: (rows: TraceListItem[]) => rows,
}));

vi.mock("../../markdownView", () => ({ RenderedMarkdown: () => null }));

/** The turn itself is covered by its own tests; the notice sits above them. */
vi.mock("../AnnotatedTurnRow", () => ({
  AnnotatedTurnRow: ({ parsed }: { parsed: { turn: { traceId: string } } }) => (
    <div data-testid="annotated-turn-row">{parsed.turn.traceId}</div>
  ),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { NO_TRACE_EVENTS, type TraceListItem } from "../../../../types/trace";
import { ConversationView } from "../ConversationView";

function turn(over: Partial<TraceListItem> = {}): TraceListItem {
  return {
    traceId: "trace-1",
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
    input: "book me a room",
    output: "your room is booked",
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
    ...over,
  };
}

function renderConversation(items: TraceListItem[]) {
  turns.splice(0, turns.length, ...items);
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationView conversationId="thread-1" currentTraceId="trace-1" />
    </ChakraProvider>,
  );
}

const notices = () =>
  screen.queryAllByText(/redacted by this project's privacy settings/i);

afterEach(cleanup);

describe("given a conversation whose content carries a redaction marker", () => {
  /** @scenario "A conversation carrying a redaction marker shows the notice" */
  it("says content was redacted by the project's privacy settings", () => {
    renderConversation([turn({ input: "reach me at [EMAIL_ADDRESS]" })]);

    expect(notices()).toHaveLength(1);
  });

  /** @scenario "A conversation carrying a redaction marker shows the notice" */
  it("links to the data-privacy settings page", () => {
    renderConversation([turn({ input: "reach me at [EMAIL_ADDRESS]" })]);

    expect(
      screen.getByRole("link", { name: /Settings/i }).getAttribute("href"),
    ).toBe("/settings/data-privacy");
  });

  /** @scenario "A conversation carrying a redaction marker shows the notice" */
  it("raises the notice for a marker in the reply as well", () => {
    renderConversation([turn({ output: "your key is [SECRET]" })]);

    expect(notices()).toHaveLength(1);
  });
});

describe("given several turns carrying redaction markers", () => {
  /** @scenario "Several redacted turns still show one notice" */
  it("shows one notice for the whole conversation", () => {
    renderConversation([
      turn({ traceId: "trace-1", input: "reach me at [EMAIL_ADDRESS]" }),
      turn({ traceId: "trace-2", input: "or on [PHONE_NUMBER]" }),
      turn({ traceId: "trace-3", output: "your key is [SECRET]" }),
    ]);

    expect(screen.getAllByTestId("annotated-turn-row")).toHaveLength(3);
    expect(notices()).toHaveLength(1);
  });
});

describe("given a conversation with no redaction markers", () => {
  /** @scenario "A conversation with no markers shows no notice" */
  it("shows no notice", () => {
    renderConversation([turn()]);

    expect(notices()).toHaveLength(0);
  });

  /** @scenario "Ordinary bracketed text does not raise the notice" */
  it("ignores ordinary bracketed text", () => {
    renderConversation([turn({ input: "[INFO] the job started" })]);

    expect(notices()).toHaveLength(0);
  });
});
