/**
 * @vitest-environment jsdom
 * The dashboard list in the analytics menu: rename, reorder and delete.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

const api = vi.hoisted(() => ({
  dashboards: [] as { id: string; name: string }[],
  sent: [] as unknown[],
}));

vi.mock("../../../behavior/analytics-api.ts", () => {
  const mutation = (name: string) => ({
    useMutation: () => ({
      mutate: (input: unknown) => api.sent.push({ [name]: input }),
      isPending: false,
    }),
  });
  return {
    analyticsApi: {
      useUtils: () => ({ licenseEnforcement: { checkLimit: { invalidate: vi.fn() } } }),
      dashboards: {
        getAll: {
          useQuery: () => ({ data: api.dashboards, isLoading: false, refetch: vi.fn() }),
        },
        rename: mutation("rename"),
        delete: mutation("delete"),
        reorderDashboards: mutation("reorder"),
        create: mutation("create"),
      },
    },
  };
});

import { CustomDashboardsSection } from "../custom-dashboards-section.tsx";

function mount(dashboards: { id: string; name: string }[]) {
  api.dashboards = dashboards;
  api.sent = [];
  const host = new StubAnalyticsHost({
    route: { params: {}, query: { dashboard: dashboards[0]?.id } },
  });
  render(
    <AnalyticsTestHarness host={host}>
      <CustomDashboardsSection projectSlug="my-project" />
    </AnalyticsTestHarness>,
  );
  return userEvent.setup();
}

const THREE = [
  { id: "d1", name: "Overview" },
  { id: "d2", name: "Costs" },
  { id: "d3", name: "Quality" },
];

async function openMenuOf(user: ReturnType<typeof userEvent.setup>, name: string) {
  const row = screen.getByText(name).closest("a")!.parentElement!;
  await user.click(within(row).getByRole("button"));
}

describe("the custom dashboards list", () => {
  beforeEach(() => {
    api.sent = [];
  });

  it("offers move up and down only where there is room, and delete only with more than one", async () => {
    const user = mount(THREE);
    await openMenuOf(user, "Overview");
    expect(screen.queryByText("Move Up")).toBeNull();
    expect(screen.getByText("Move Down")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("reorders by swapping with the neighbour", async () => {
    const user = mount(THREE);
    await openMenuOf(user, "Costs");
    await user.click(screen.getByText("Move Up"));
    expect(api.sent).toEqual([
      { reorder: { projectId: "proj-1", dashboardIds: ["d2", "d1", "d3"] } },
    ]);
  });

  it("renames with the trimmed name on Enter, and drops the edit on Escape", async () => {
    const user = mount(THREE);
    await openMenuOf(user, "Quality");
    await user.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("Quality");
    await user.clear(input);
    await user.type(input, "  Evals  {Enter}");
    expect(api.sent).toEqual([
      { rename: { projectId: "proj-1", dashboardId: "d3", name: "Evals" } },
    ]);

    await openMenuOf(user, "Costs");
    await user.click(screen.getByText("Rename"));
    await user.type(screen.getByDisplayValue("Costs"), "x{Escape}");
    expect(api.sent).toHaveLength(1);
  });

  it("deletes after confirmation", async () => {
    const user = mount(THREE);
    await openMenuOf(user, "Costs");
    await user.click(screen.getByText("Delete"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.sent).toEqual([{ delete: { projectId: "proj-1", dashboardId: "d2" } }]);
  });

  it("never offers to delete the last dashboard", async () => {
    const user = mount([{ id: "d1", name: "Overview" }]);
    await openMenuOf(user, "Overview");
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
