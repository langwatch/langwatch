/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ registry: vi.fn(), snapshot: vi.fn() }));
vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      listProjections: { useQuery: reads.registry },
      getDashboardSnapshot: { useQuery: reads.snapshot },
    },
  },
}));
import { ProjectionsCard } from "../ui/sections/projections-panel.tsx";

afterEach(cleanup);
beforeEach(() => {
  reads.registry.mockReturnValue({ data: { projections: [] }, isPending: false, isError: false });
  reads.snapshot.mockReturnValue({ data: { pipelineTree: [] }, isPending: false, isError: false });
});
describe("projection read states", () => {
  it("keeps an unfinished registry read distinct from an empty registry", () => {
    reads.registry.mockReturnValue({ data: void 0, isPending: true, isError: false });
    renderWithDesignSystem(<ProjectionsCard />);
    expect(screen.getByLabelText("Loading projections")).toBeTruthy();
    expect(screen.queryByText("No projections registered.")).toBeNull();
  });
  it.each(["registry", "snapshot"] as const)(
    "reports a failed %s without claiming idle health",
    (source) => {
      reads[source].mockReturnValue({
        data: void 0,
        isPending: false,
        isError: true,
        error: new Error("unavailable"),
      });
      renderWithDesignSystem(<ProjectionsCard />);
      expect(screen.getByRole("alert").textContent).toContain("The projections could not load");
      expect(screen.queryByText("No projections registered.")).toBeNull();
    },
  );
});
