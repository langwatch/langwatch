// @vitest-environment jsdom
/**
 * The Session ID column: the conversation id under its coding-agent name, on both row kinds.
 * @see modules/trace/specs/sessions-lens.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ConversationGroup } from "../../../../../behavior/explorer/trace-table/conversation-groups.ts";
import type { TraceListItem } from "../../../../../behavior/explorer/types/trace.ts";
import { NO_TRACE_EVENTS } from "../../../../../behavior/explorer/types/trace.ts";
import { mapSessionGroupToConversationGroup } from "../../../../../behavior/explorer/utils/map-session-groups-payload.ts";
import type { SessionGroupPayloadItem } from "../../../../../model/explorer/session-group-payload.ts";
import { getCapability } from "../../../../../model/lens-capabilities.ts";
import { buildConversationColumns, getTraceColumnDef } from "../columns.ts";
import { conversationCells } from "../registry/cells/conversation/index.ts";
import { traceCells } from "../registry/cells/trace/index.ts";
import type { CellRenderContext } from "../registry/types.ts";

const SESSION_ID = "9f1c2a7e-4b1d-4c0e-8a55-0d3e5b6f7a81";

const DENSITY = {
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

function context<Row>(row: Row): CellRenderContext<Row> {
  return {
    row,
    density: DENSITY,
    densityMode: "compact",
    isExpanded: false,
    isSelected: false,
    isFocused: false,
    actions: {},
    enabledAddonIds: [],
  };
}

function trace(overrides: Partial<TraceListItem> = {}): TraceListItem {
  return {
    traceId: "trace-1",
    timestamp: 1700000000000,
    name: "turn",
    serviceName: "coding-agent-cli",
    durationMs: 1000,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    input: null,
    output: null,
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
    sizeBytes: 0,
    ...overrides,
  };
}

function sessionRollup(): ConversationGroup {
  const payload: SessionGroupPayloadItem = {
    conversationId: SESSION_ID,
    projectId: "project-1",
    traceCount: 3,
    totalCost: 1.2,
    totalTokens: 12_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextSizeTokens: null,
    totalDurationMs: 60_000,
    startedAtMs: 1700000000000,
    lastActivityMs: 1700000060000,
    models: ["claude-sonnet"],
    primaryModel: "claude-sonnet",
    serviceName: "coding-agent-cli",
    errorCount: 0,
    warningCount: 0,
    totalSpans: 9,
    lastTraceId: "trace-3",
    input: null,
    output: null,
    codingAgent: null,
  };
  return mapSessionGroupToConversationGroup(payload);
}

function renderCell(node: React.ReactNode) {
  return renderWithDesignSystem(node as React.ReactElement);
}

afterEach(cleanup);

describe("the Session ID column", () => {
  describe("given a trace row carrying a session id", () => {
    it("shows the id in mono, truncated, as a column the picker offers", () => {
      const cell = traceCells.sessionId;
      renderCell(cell.render(context(trace({ conversationId: SESSION_ID }))));

      const id = screen.getByText(SESSION_ID);
      expect(id).toHaveAttribute("title", SESSION_ID);
      expect(getCapability("flat").columns.map((c) => c.id)).toContain("sessionId");
      expect(getTraceColumnDef("sessionId")).toMatchObject({ header: "Session ID" });
    });

    it("shows a dash for a trace with no session", () => {
      renderCell(traceCells.sessionId.render(context(trace({ conversationId: null }))));

      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("given session rollups whose only identity is a session id", () => {
    /** @scenario "Grouping by conversation groups traces that carry only a session id" */
    it("keys each session row by that id and shows it in the Session ID column", () => {
      const row = sessionRollup();

      expect(row.conversationId).toBe(SESSION_ID);
      expect(getCapability("by-conversation").columns.map((c) => c.id)).toContain("sessionId");
      expect(buildConversationColumns(["sessionId"])).toMatchObject([{ header: "Session ID" }]);
      const cell = conversationCells.sessionId;
      if (!cell) throw new Error("No conversation cell registered for sessionId");
      renderCell(cell.render(context(row)));
      expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    });
  });
});
