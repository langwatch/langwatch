/**
 * @vitest-environment jsdom
 *
 * The sessions lens row shows TRUE rollup totals: the cells read the
 * server-computed per-session aggregates off the mapped group, never the
 * page-local `traces` array (which is empty until the row expands).
 *
 * @see specs/traces-v2/sessions-lens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { getCapability } from "../../../lens/capabilities";
import { truncateId } from "@langwatch/trace-web";
import {
  mapSessionGroupToConversationGroup,
  type SessionGroupPayloadItem,
} from "../../../utils/mapSessionGroupsPayload";
import type { ConversationGroup } from "../conversationGroups";
import { ConversationSummaryDetail } from "../registry/addons/conversation/ConversationSummary";
import { conversationCells } from "../registry/cells/conversation";
import { sessionLabelOf } from "../registry/cells/conversation/ConversationCell";
import type { CellRenderContext } from "../registry/types";

const COMPACT_TOKENS = {
  rowPaddingY: "3px",
  rowFontSize: "12px",
  ioFontSize: "11px",
  ioPaddingTop: "2px",
  ioPaddingBottom: "4px",
  groupRowPaddingY: "5px",
  errorRowPaddingY: "4px",
  errorRowFontSize: "12px",
  errorDetailPaddingBottom: "4px",
} as const;

function cellContext(row: ConversationGroup): CellRenderContext<ConversationGroup> {
  return {
    row,
    density: COMPACT_TOKENS,
    densityMode: "compact",
    isExpanded: false,
    isSelected: false,
    isFocused: false,
    actions: {},
    enabledAddonIds: [],
  };
}

function serverSession(
  overrides: Partial<SessionGroupPayloadItem> = {},
): ConversationGroup {
  return mapSessionGroupToConversationGroup({
    conversationId: "sess-rollup",
    traceCount: 128,
    totalCost: 42.5,
    totalTokens: 2_400_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextSizeTokens: 154_000,
    totalDurationMs: 3_600_000,
    startedAtMs: Date.now() - 3_600_000,
    lastActivityMs: Date.now() - 60_000,
    models: ["gpt-5-mini"],
    primaryModel: "gpt-5-mini",
    serviceName: "coding-agent-cli",
    errorCount: 0,
    warningCount: 0,
    totalSpans: 900,
    lastTraceId: "trace-latest",
    input: "latest prompt",
    output: "latest answer",
    codingAgent: {
      modelCalls: 63,
      compactions: 4,
      peakContextTokens: 173_000,
      subAgents: 2,
      pullRequest: null,
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      gitBranch: "feat/git-context",
      gitWorktree: "widgets-feat",
      title: "Add git context to the session row",
      titleRedacted: false,
    },
    ...overrides,
  });
}

function renderCell({ cellId, row }: { cellId: string; row: ConversationGroup }) {
  const cell = conversationCells[cellId];
  if (!cell) throw new Error(`No conversation cell registered for ${cellId}`);
  return render(
    <ChakraProvider value={defaultSystem}>
      {cell.render(cellContext(row)) as React.ReactElement}
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("sessions lens cells", () => {
  describe("given the sessions lens is active with server-grouped session rows", () => {
    /** @scenario The sessions lens renders server rollup totals */
    it("shows the session's total traces, tokens and cost from the rollup, not the trace page", () => {
      const row = serverSession();
      // The page-local traces array is EMPTY, every number below can only
      // come from the server rollup.
      expect(row.traces).toHaveLength(0);

      renderCell({ cellId: "turns", row });
      expect(screen.getByText("128")).toBeInTheDocument();
      expect(screen.getByText("traces")).toBeInTheDocument();

      renderCell({ cellId: "tokens", row });
      expect(screen.getByText("2.4M")).toBeInTheDocument();

      renderCell({ cellId: "cost", row });
      expect(screen.getByText("$42.50")).toBeInTheDocument();
    });

    it("shows last activity, context size, model calls and compactions", () => {
      const row = serverSession();

      renderCell({ cellId: "lastTurn", row });
      expect(screen.getByText(/1m|60s|1 minute/)).toBeInTheDocument();

      renderCell({ cellId: "contextSize", row });
      // Enriched sessions surface the coding-agent fold's peak context.
      expect(screen.getByText("173.0K")).toBeInTheDocument();

      renderCell({ cellId: "modelCalls", row });
      expect(screen.getByText("63")).toBeInTheDocument();

      renderCell({ cellId: "compactions", row });
      expect(screen.getByText("4")).toBeInTheDocument();
    });

    // A session that reported a peak of zero said something; only a session
    // that never reported one is a gap. The mapper preserves the difference,
    // so the cell has to as well.
    it("shows a reported context size of zero as zero, not a dash", () => {
      const row = serverSession({
        contextSizeTokens: 0,
        codingAgent: null,
      });

      renderCell({ cellId: "contextSize", row });

      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("dashes model calls and compactions for sessions without a coding-agent row", () => {
      const row = serverSession({ codingAgent: null });

      renderCell({ cellId: "modelCalls", row });
      renderCell({ cellId: "compactions", row });
      // The shared dash placeholder glyph, same as every other empty cell.
      expect(screen.getAllByText("—")).toHaveLength(2);
    });
  });

  // A number pinned to an icon and nothing else is a riddle: readers took the
  // span count for a pull request number. The counts that survive carry the
  // word that says what they count.
  describe("given a conversation row rolling up many spans", () => {
    /** @scenario A conversation row carries no bare icon counters */
    it("shows no unlabelled span count on the row, and keeps the counted words in the expanded summary", () => {
      const row = serverSession();

      renderCell({ cellId: "conversation", row });
      expect(screen.queryByText("900")).not.toBeInTheDocument();

      cleanup();
      render(
        <ChakraProvider value={defaultSystem}>
          <ConversationSummaryDetail group={row} />
        </ChakraProvider>,
      );
      expect(screen.getByText("900 spans")).toBeInTheDocument();
    });
  });

  describe("given session rows enriched with a repository and a mapped pull request", () => {
    /** @scenario The sessions lens offers repository and pull request columns */
    it("shows the owner and name, and links the pull request number", () => {
      const row = serverSession({
        codingAgent: {
          modelCalls: 63,
          compactions: 4,
          peakContextTokens: 173_000,
          subAgents: 2,
          repositoryHost: "github.com",
          repositoryOwner: "acme",
          repositoryName: "widgets",
          gitBranch: "feat/git-context",
          gitWorktree: "widgets-feat",
          title: "Add git context to the session row",
          titleRedacted: false,
          pullRequest: {
            number: 4218,
            htmlUrl: "https://github.com/acme/widgets/pull/4218",
            title: "Carry git context onto the session row",
          },
        },
      });

      renderCell({ cellId: "repository", row });
      expect(screen.getByText("acme/widgets")).toBeInTheDocument();

      renderCell({ cellId: "pullRequest", row });
      const link = screen.getByText("#4218").closest("a");
      expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/pull/4218");
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("keeps both columns out of the sessions lens defaults", () => {
      const capability = getCapability("by-conversation");
      const ids = capability.columns.map((column) => column.id);

      expect(ids).toContain("repository");
      expect(ids).toContain("pullRequest");
      expect(capability.defaultColumns).not.toContain("repository");
      expect(capability.defaultColumns).not.toContain("pullRequest");
      // The session rollup does not order by either, so neither offers a sort.
      expect(capability.sortableColumnIds).not.toContain("repository");
      expect(capability.sortableColumnIds).not.toContain("pullRequest");
    });

    it("dashes the repository and pull request a session never reported", () => {
      const row = serverSession({ codingAgent: null });

      renderCell({ cellId: "repository", row });
      renderCell({ cellId: "pullRequest", row });

      expect(screen.getAllByText("—")).toHaveLength(2);
    });
  });

  describe("given a session row whose title is present and not redacted", () => {
    /** @scenario A session with a visible title shows it as its label */
    it("uses the title as the session's label", () => {
      const row = serverSession();

      expect(sessionLabelOf(row)).toBe("Add git context to the session row");
    });

    it("keeps the shortened conversation id when there is no title", () => {
      const row = serverSession({
        conversationId: "sess-0123456789abcdef",
        codingAgent: null,
      });

      expect(sessionLabelOf(row)).toBe(truncateId("sess-0123456789abcdef"));
    });

    // Redaction is decided server-side: a hidden title arrives as null with
    // the flag set, and the label falls back rather than leaking anything.
    it("falls back to the conversation id when the title is redacted", () => {
      const row = serverSession({
        conversationId: "sess-0123456789abcdef",
        codingAgent: {
          modelCalls: 0,
          compactions: 0,
          peakContextTokens: 0,
          subAgents: 0,
          repositoryHost: null,
          repositoryOwner: null,
          repositoryName: null,
          gitBranch: null,
          gitWorktree: null,
          title: null,
          titleRedacted: true,
          pullRequest: null,
        },
      });

      expect(sessionLabelOf(row)).toBe(truncateId("sess-0123456789abcdef"));
    });
  });
});
