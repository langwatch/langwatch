/**
 * @vitest-environment jsdom
 *
 * A conversation-view turn whose content was hidden by a privacy rule renders
 * the shared "Redacted" marker on the affected side instead of silently
 * dropping the bubble — so a hidden turn is never mistaken for a turn where the
 * user said nothing / the assistant produced no response.
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

// RedactedInline looks up org permissions for the settings link.
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

describe("ChatTurnRow redaction", () => {
  describe("given the assistant output was redacted", () => {
    it("renders the Redacted marker on the assistant side", () => {
      renderRow(
        { outputRedacted: true, outputVisibleTo: "Admins" },
        { user: "what is the funnel rate?" },
      );
      expect(screen.getByText("Redacted")).toBeInTheDocument();
      expect(screen.getByText(/visible to Admins/i)).toBeInTheDocument();
    });
  });

  describe("given the user input was redacted", () => {
    it("renders the Redacted marker on the user side", () => {
      renderRow(
        { inputRedacted: true, inputVisibleTo: "no one" },
        { assistant: "the answer" },
      );
      expect(screen.getByText("Redacted")).toBeInTheDocument();
      expect(
        screen.getByText(/hidden by privacy settings/i),
      ).toBeInTheDocument();
    });
  });

  describe("given a turn with genuinely no assistant output and no redaction", () => {
    it("does not render a Redacted marker", () => {
      renderRow({ outputRedacted: false }, { user: "hi" });
      expect(screen.queryByText("Redacted")).not.toBeInTheDocument();
    });
  });
});
