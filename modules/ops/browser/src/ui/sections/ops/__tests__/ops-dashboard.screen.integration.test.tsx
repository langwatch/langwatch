/** @vitest-environment jsdom */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const snapshotQuery = vi.hoisted(() => vi.fn());

vi.mock("../../../../behavior/ops-api.ts", () => ({
  api: { ops: { getDashboardSnapshot: { useQuery: snapshotQuery } } },
}));
vi.mock("../../../../behavior/ops-overlays.ts", () => ({
  useOpsOverlay: () => ({ value: null, open: vi.fn(), close: vi.fn() }),
}));

import OpsDashboardScreen from "../ops-dashboard.screen.tsx";

afterEach(cleanup);

function renderScreen() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <OpsDashboardScreen />
    </DesignSystemProvider>,
  );
}

describe("OpsDashboardScreen", () => {
  describe("when the snapshot read is refused", () => {
    it("says the dashboard could not load instead of loading forever", () => {
      snapshotQuery.mockReturnValue({
        data: undefined,
        isError: true,
        isSuccess: false,
        error: new Error("FORBIDDEN"),
      });

      renderScreen();

      expect(screen.getByRole("alert").textContent).toContain("The ops dashboard could not load");
      expect(screen.queryByLabelText("Loading metrics")).toBeNull();
    });
  });

  describe("when the first snapshot has not arrived", () => {
    it("shows the loading skeleton", () => {
      snapshotQuery.mockReturnValue({
        data: undefined,
        isError: false,
        isSuccess: false,
        error: null,
      });

      renderScreen();

      expect(screen.getByLabelText("Loading metrics")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
