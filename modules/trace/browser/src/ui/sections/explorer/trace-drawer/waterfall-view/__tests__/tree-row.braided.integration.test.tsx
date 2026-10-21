/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BraidedTracePill } from "../../../../../blocks/explorer/trace-drawer/braids/braided-trace-pill.tsx";
import { TreeRow } from "../tree-row.tsx";

afterEach(cleanup);

const braidedSpan: SpanTreeNode = {
  spanId: "span-1",
  parentSpanId: null,
  name: "payments_agent",
  type: "agent",
  startTimeMs: 0,
  endTimeMs: 100,
  durationMs: 100,
  status: "ok",
  model: null,
  ownerProjectId: "specialists",
};

const rowProps = {
  rootStart: 0,
  rootDuration: 1000,
  isSelected: false,
  isPrompt: false,
  logCount: 0,
  isCollapsed: false,
  hasChildren: false,
  hiddenDescendantCount: 0,
  isDimmed: false,
  signals: [],
  onToggleCollapse: vi.fn(),
  onSelect: vi.fn(),
};

describe("given a trace holding braided spans", () => {
  /** @scenario "A braided span carries a badge naming its owning project" */
  it("badges each braided span with its owner and says so in the header", () => {
    renderWithDesignSystem(
      <>
        <BraidedTracePill
          owners={[{ projectId: "specialists", name: "Specialists", canOpen: false }]}
        />
        <TreeRow
          node={{ span: braidedSpan, children: [], depth: 0, isOrphaned: false }}
          braid={{
            ownerProjectId: "specialists",
            ownerName: "Specialists",
            colour: "feature.braids.project.1",
          }}
          {...rowProps}
        />
      </>,
    );

    expect(screen.getByTestId("braided-span-badge")).toHaveTextContent("Specialists");
    expect(screen.getByLabelText("Includes spans from Specialists")).toBeInTheDocument();
  });
});

describe("given a trace holding only the project's own spans", () => {
  it("shows no badge and no header pill", () => {
    const { ownerProjectId: _owner, ...ownSpan } = braidedSpan;
    renderWithDesignSystem(
      <>
        <BraidedTracePill owners={[]} />
        <TreeRow
          node={{ span: ownSpan, children: [], depth: 0, isOrphaned: false }}
          {...rowProps}
        />
      </>,
    );

    expect(screen.queryByTestId("braided-span-badge")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Includes spans from/)).not.toBeInTheDocument();
  });
});
