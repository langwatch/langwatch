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
import {
  mapSessionGroupToConversationGroup,
  type SessionGroupPayloadItem,
} from "../../../utils/mapSessionGroupsPayload";
import type { ConversationGroup } from "../conversationGroups";
import { conversationCells } from "../registry/cells/conversation";
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

function cellContext(
  row: ConversationGroup,
): CellRenderContext<ConversationGroup> {
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

function renderCell({
  cellId,
  row,
}: {
  cellId: string;
  row: ConversationGroup;
}) {
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
      expect(screen.getByText("2400.0K")).toBeInTheDocument();

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
});
