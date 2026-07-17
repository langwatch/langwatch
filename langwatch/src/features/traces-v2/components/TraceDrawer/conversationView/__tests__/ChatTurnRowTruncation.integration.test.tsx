/**
 * @vitest-environment jsdom
 *
 * #5835: a conversation-view turn whose message is still a write-time preview
 * (because the full input/output could not be loaded at read time) renders the
 * shared "content may be incomplete" notice on the affected side, so a truncated
 * message is never mistaken for the complete value.
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

// The turn separator pulls annotation data via tRPC; stub the leaf components.
vi.mock("../TurnAnnotations", () => ({
  TurnActionRow: () => null,
  TurnAnnotationBadges: () => null,
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

// A visible turn never renders RedactedInline, but keep the org lookup stubbed
// to mirror the proven ChatTurnRow harness and stay resilient to leaf changes.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

import type { TraceListItem } from "../../../../types/trace";
import { ChatTurnRow } from "../ChatTurnRow";

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

function renderRow(
  over: Partial<TraceListItem>,
  texts?: { user?: string; assistant?: string },
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChatTurnRow
        layout="thread"
        turn={turn(over)}
        userText={texts?.user ?? ""}
        assistantText={texts?.assistant ?? ""}
        assistantReasoning=""
        gapSecs={0}
        showGap={false}
        index={1}
        isCurrent={false}
        onSelect={() => undefined}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("ChatTurnRow content-incomplete notice", () => {
  describe("given a conversation turn", () => {
    describe("when the input is still a truncated preview", () => {
      it("warns the message may be incomplete", () => {
        renderRow(
          { inputTruncated: true },
          { user: "what is the funnel rate?" },
        );
        expect(
          screen.getByText(/could not be fully loaded/i),
        ).toBeInTheDocument();
      });
    });

    describe("when the output is still a truncated preview", () => {
      it("warns the response may be incomplete", () => {
        renderRow({ outputTruncated: true }, { assistant: "the answer" });
        expect(
          screen.getByText(/could not be fully loaded/i),
        ).toBeInTheDocument();
      });
    });

    describe("when the content loaded fully", () => {
      it("does not render the notice", () => {
        renderRow({}, { user: "hi", assistant: "hello" });
        expect(
          screen.queryByText(/could not be fully loaded/i),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the input is a truncated preview but redacted by a privacy rule", () => {
      it("suppresses the notice — the viewer sees a Redacted marker, not a preview", () => {
        renderRow({ inputTruncated: true, inputRedacted: true });
        expect(
          screen.queryByText(/could not be fully loaded/i),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the output is a truncated preview but redacted by a privacy rule", () => {
      it("suppresses the notice on the response side", () => {
        renderRow({ outputTruncated: true, outputRedacted: true });
        expect(
          screen.queryByText(/could not be fully loaded/i),
        ).not.toBeInTheDocument();
      });
    });
  });
});
