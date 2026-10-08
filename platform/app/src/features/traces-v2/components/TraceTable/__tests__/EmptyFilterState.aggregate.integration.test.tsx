/**
 * @vitest-environment jsdom
 *
 * ADR-144: an aggregate reads each member from when it was attached, so an
 * empty aggregate whose window reaches back before it was created says when
 * its traces start, instead of suggesting a wider window that cannot help.
 *
 * @see specs/governance/aggregate-project.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { EmptyFilterState } from "../EmptyFilterState";

const DAY = 24 * 60 * 60 * 1000;
// Midday UTC, so the date reads the same in every test timezone.
const CREATED_AT = Date.parse("2026-10-08T12:00:00Z");

const explorerState = {
  queryText: "",
  clearAll: vi.fn(),
  timeRange: { from: CREATED_AT - 2 * DAY, to: CREATED_AT + DAY },
  setTimeRange: vi.fn(),
  activeLensId: "all-traces",
  selectLens: vi.fn(),
};

vi.mock("../../../stores/explorerStore", () => ({
  useExplorerStore: (selector: (s: typeof explorerState) => unknown) =>
    selector(explorerState),
}));

vi.mock("../../../hooks/useInstantEvalRuns", () => ({
  useInstantEvalRuns: () => ({ chips: [] }),
}));

const runState = { runs: {}, settled: {} };
vi.mock("../../../stores/instantEvalRunStore", () => ({
  useInstantEvalRunStore: (selector: (s: typeof runState) => unknown) =>
    selector(runState),
}));

vi.mock("../QueryBreakdownChips", () => ({
  QueryBreakdownChips: () => null,
}));

let mockProject: { id: string; kind: string; createdAt: Date };
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: mockProject }),
}));

function renderEmptyState() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EmptyFilterState />
    </ChakraProvider>,
  );
}

describe("<EmptyFilterState /> on an aggregate project", () => {
  afterEach(cleanup);

  describe("when the window reaches back before the aggregate was created", () => {
    beforeEach(() => {
      mockProject = {
        id: "aggregate-1",
        kind: "aggregate",
        createdAt: new Date(CREATED_AT),
      };
    });

    /** @scenario "An empty aggregate says its traces start when it was created" */
    it("says traces start on the day it was created and offers no wider window", () => {
      renderEmptyState();
      expect(
        screen.getByText("Nothing since this aggregate was created"),
      ).toBeInTheDocument();
      expect(screen.getByText(/from 8 October 2026/)).toBeInTheDocument();
      expect(screen.queryByText(/wider time window/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Last 7 days" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the project is a plain project", () => {
    beforeEach(() => {
      mockProject = {
        id: "project-1",
        kind: "application",
        createdAt: new Date(CREATED_AT),
      };
    });

    /** @scenario "An empty aggregate says its traces start when it was created" */
    it("still suggests and offers a wider time window", () => {
      renderEmptyState();
      expect(screen.getByText("Nothing in this range")).toBeInTheDocument();
      expect(screen.getByText(/wider time window/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Last 7 days" }),
      ).toBeInTheDocument();
    });
  });
});
