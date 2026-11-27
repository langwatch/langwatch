// @vitest-environment jsdom
/**
 * A card reads the project it is opened under: on an Organization board that is the project
 * the Project chip names, whoever owns the board, and a query that stores no projects names none.
 * @see modules/dashboard/specs/dashboards-v2.feature AC206c
 */
import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("../../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({ client: { analytics: { lwql: { query: { mutate } } } } }),
  },
}));

import {
  useDashboardWidgetExecutor,
  WidgetReadsEveryProjectContext,
} from "../use-dashboard-widget-executor.ts";

const QUERY: DashboardWidgetQuery = { name: "main", sql: "SELECT 1 AS n" };

async function runUnder(
  projectId: string,
  { readsEveryProject = false }: { readsEveryProject?: boolean } = {},
): Promise<{ projectId: string; projects?: unknown }> {
  mutate.mockReset();
  mutate.mockResolvedValue({
    columns: [],
    rows: [],
    statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    diagnostics: [],
    followsTimeWindow: false,
    followsGranularity: false,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WidgetReadsEveryProjectContext.Provider value={readsEveryProject}>
      {children}
    </WidgetReadsEveryProjectContext.Provider>
  );
  const { result } = renderHook(() => useDashboardWidgetExecutor(projectId, [QUERY]), { wrapper });
  await result.current.executeQuery({
    queryName: "main",
    params: {},
    signal: new AbortController().signal,
  });

  return mutate.mock.calls[0]?.[0] as { projectId: string; projects?: unknown };
}

describe("given an Organization board opened under two different projects", () => {
  /** @scenario "AC206c Project: an organization board reads the project its Project chip names" */
  it("runs each widget under the project in view, naming no projects of its own", async () => {
    const underOwner = await runUnder("proj-owner");
    const underViewer = await runUnder("proj-viewer");

    expect(underOwner.projectId).toBe("proj-owner");
    expect(underViewer.projectId).toBe("proj-viewer");
    expect(underViewer).not.toHaveProperty("projects");
  });
});

describe("given a Gateway or Governance board, which reads the organization (ADR-002, D2)", () => {
  /** @scenario "A Gateway or Governance board's widget reads every project I may read" */
  it('runs a widget that names no projects over "all" the member may read', async () => {
    const run = await runUnder("proj-anchor", { readsEveryProject: true });

    expect(run).toMatchObject({ projectId: "proj-anchor", projects: "all" });
  });
});
