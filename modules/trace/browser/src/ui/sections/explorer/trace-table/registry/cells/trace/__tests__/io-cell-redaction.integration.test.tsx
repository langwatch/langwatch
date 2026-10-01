// I/O cells: redacted content shows "Redacted" marker, empty content shows
// em-dash.
// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// RedactedInline (rendered by the cells when redacted) looks up the org's
// permissions to decide whether to show the "Open privacy settings" link.
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

// The redacted marker itself (`RedactedInline`) still reads scope through the
// trace-scoped host - it is only ever rendered inside a trace screen.
vi.mock("../../../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

import { NO_TRACE_EVENTS, type TraceListItem } from "../../../../../types/trace.ts";
import type { CellRenderContext } from "../../../types.ts";
import { InputCell } from "../input-cell.tsx";
import { OutputCell } from "../output-cell.tsx";

function row(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 0,
    name: "trace",
    serviceName: "svc",
    durationMs: 1,
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

function cellContext(row: TraceListItem): CellRenderContext<TraceListItem> {
  return {
    row,
    density: {
      rowPaddingY: "3px",
      rowFontSize: "12px",
      ioFontSize: "11px",
      ioPaddingTop: "2px",
      ioPaddingBottom: "4px",
      groupRowPaddingY: "5px",
      errorRowPaddingY: "4px",
      errorRowFontSize: "12px",
      errorDetailPaddingBottom: "4px",
    },
    densityMode: "compact",
    isExpanded: false,
    isSelected: false,
    isFocused: false,
    actions: {},
    enabledAddonIds: [],
  };
}

function renderInput(over: Partial<TraceListItem>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {InputCell.render(cellContext(row(over)))}
    </ChakraProvider>,
  );
}

function renderOutput(over: Partial<TraceListItem>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {OutputCell.render(cellContext(row(over)))}
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("Input/Output table cells", () => {
  describe("given the input is redacted by a privacy rule", () => {
    it("shows the Redacted marker instead of an em-dash", () => {
      const { getByText, queryByText } = renderInput({
        input: null,
        inputRedacted: true,
        inputVisibleTo: "Admins",
      });
      expect(getByText("Redacted")).toBeInTheDocument();
      // The audience hint rides along so the reader knows who can see it.
      expect(getByText(/visible to Admins/i)).toBeInTheDocument();
      expect(queryByText("—")).not.toBeInTheDocument();
    });
  });

  describe("given the input is genuinely absent", () => {
    it("keeps the em-dash and shows no Redacted marker", () => {
      const { getByText, queryByText } = renderInput({
        input: null,
        inputRedacted: false,
      });
      expect(getByText("—")).toBeInTheDocument();
      expect(queryByText("Redacted")).not.toBeInTheDocument();
    });
  });

  describe("given the input has visible content", () => {
    it("renders the content and no Redacted marker", () => {
      const { getByText, queryByText } = renderInput({
        input: "hello world",
        inputRedacted: false,
      });
      expect(getByText("hello world")).toBeInTheDocument();
      expect(queryByText("Redacted")).not.toBeInTheDocument();
    });
  });

  describe("given the output is redacted by a privacy rule", () => {
    it("shows the Redacted marker instead of an em-dash", () => {
      const { getByText, queryByText } = renderOutput({
        output: null,
        outputRedacted: true,
        outputVisibleTo: "no one",
      });
      expect(getByText("Redacted")).toBeInTheDocument();
      expect(getByText(/hidden by privacy settings/i)).toBeInTheDocument();
      expect(queryByText("—")).not.toBeInTheDocument();
    });
  });

  describe("given the output is genuinely absent", () => {
    it("keeps the em-dash and shows no Redacted marker", () => {
      const { getByText, queryByText } = renderOutput({
        output: null,
        outputRedacted: false,
      });
      expect(getByText("—")).toBeInTheDocument();
      expect(queryByText("Redacted")).not.toBeInTheDocument();
    });
  });
});
