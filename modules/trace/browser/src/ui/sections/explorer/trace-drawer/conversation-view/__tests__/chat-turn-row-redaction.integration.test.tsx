// Redacted turn: shows "Redacted" marker, not silent bubble drop (never
// mistaken for empty turn).
// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../scenario-roles.tsx", async () => {
  const actual = await vi.importActual<typeof scenarioRolesModule>("../../scenario-roles");
  return { ...actual, useIsScenarioRole: () => false };
});

vi.mock("@langwatch/trace-browser-kit", async () => {
  const actual = await vi.importActual<typeof traceBrowserKitModule>(
    "@langwatch/trace-browser-kit",
  );
  return {
    ...actual,
    useConversationExpand: () => ({
      isExpandable: false,
      shouldExpandAll: false,
    }),
    ConversationExpandContext: {
      Provider: ({ children }: { children: unknown }) => children,
    },
  };
});

// The per-turn translate hook dispatches through tRPC; these tests pin
// redaction rendering, so stub it to the identity passthrough.
vi.mock("../../../hooks/use-text-translation.ts", () => ({
  useTextTranslation: ({ texts }: { texts: Record<string, string> }) => ({
    displayTexts: texts,
    isActive: false,
    isLoading: false,
    toggle: () => undefined,
  }),
}));

// The turn separator pulls annotation data via tRPC; stub the leaf components.
vi.mock("../turn-annotations.tsx", () => ({
  TurnEditTraceAction: () => null,
  TurnSessionCheckbox: () => null,
  TurnAnnotationBadges: () => null,
}));

vi.mock("../../../../markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

// RedactedInline looks up org permissions for the settings link.
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

// The redacted marker itself (`RedactedInline`) still reads scope through the
// trace-scoped host - it is only ever rendered inside a trace screen.
vi.mock("../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

import type * as traceBrowserKitModule from "@langwatch/trace-browser-kit";

import type { TraceListItem } from "../../../types/trace.ts";
import { NO_TRACE_EVENTS } from "../../../types/trace.ts";
import type * as scenarioRolesModule from "../../scenario-roles.tsx";
import { ChatTurnRow } from "../chat-turn-row.tsx";

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

function renderRow(over: Partial<TraceListItem>, texts?: { user?: string; assistant?: string }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChatTurnRow
        layout="thread"
        turn={turn(over)}
        userText={texts?.user ?? ""}
        assistantText={texts?.assistant ?? ""}
        assistantReasoning=""
        gapSecs={0}
        shouldShowGap={false}
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
      renderRow({ inputRedacted: true, inputVisibleTo: "no one" }, { assistant: "the answer" });
      expect(screen.getByText("Redacted")).toBeInTheDocument();
      expect(screen.getByText(/hidden by privacy settings/i)).toBeInTheDocument();
    });
  });

  describe("given a turn with genuinely no assistant output and no redaction", () => {
    it("does not render a Redacted marker", () => {
      renderRow({ outputRedacted: false }, { user: "hi" });
      expect(screen.queryByText("Redacted")).not.toBeInTheDocument();
    });
  });
});
