/**
 * @vitest-environment jsdom
 *
 * The export's front door: the button that offers it, the dialog that asks how
 * deep, and what the header shows while a file is streaming.
 *
 * Rendered rather than asserted on props, because every one of these is a claim
 * about what a person sees — that the depths are labelled by what one row IS,
 * that the button is not offered when it would write nothing, and that a
 * running export can be called off.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RunHistoryFilters,
  ScenarioRunExportDialog,
  type RunHistoryFilterValues,
} from "@langwatch/suite-web";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const emptyFilters: RunHistoryFilterValues = {
  scenarioId: "",
  passFailStatus: "",
};

/**
 * The two pieces as the panel wires them: the button owns "is the dialog open",
 * the dialog owns the chosen mode. Held together here so clicking Export CSV
 * and reading the dialog is one flow rather than two prop assertions.
 */
function ExportSurface({
  runCount = 12,
  onExport = vi.fn(),
}: {
  runCount?: number;
  onExport?: (config: { mode: string }) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <RunHistoryFilters
        scenarioOptions={[]}
        filters={emptyFilters}
        onFiltersChange={vi.fn()}
        onExport={() => setIsOpen(true)}
        isExportDisabled={runCount === 0}
      />
      <ScenarioRunExportDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onExport={onExport}
        runCount={runCount}
        hasFiltersApplied={false}
      />
    </>
  );
}

describe("<ScenarioRunExportDialog/> and its trigger", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when runs match the current filters", () => {
    /** @scenario Export CSV button opens the config dialog */
    it("opens the dialog, showing how many runs would be written", async () => {
      const user = userEvent.setup();
      render(<ExportSurface runCount={1234} />, { wrapper: Wrapper });

      expect(screen.queryByText("Export Scenario Runs")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /export csv/i }));

      expect(screen.getByText("Export Scenario Runs")).toBeInTheDocument();
      // Grouped, because "1234 runs" reads as a different order of magnitude at
      // a glance than "1,234 runs".
      expect(screen.getByText(/1,234 runs/)).toBeInTheDocument();
    });

    /**
     * A scenario run is nested and CSV is flat, so the mode IS the row axis.
     * Naming the axis is what lets someone pick without exporting twice.
     */
    /** @scenario The dialog offers both export depths */
    it("offers Full and Criteria, each stating what one row is", async () => {
      const user = userEvent.setup();
      render(<ExportSurface />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /export csv/i }));

      expect(screen.getByText("Full")).toBeInTheDocument();
      expect(screen.getByText(/one row per message/i)).toBeInTheDocument();
      expect(screen.getByText("Criteria")).toBeInTheDocument();
      expect(screen.getByText(/one row per checklist item/i)).toBeInTheDocument();
    });

    it("exports in the depth that was chosen", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<ExportSurface onExport={onExport} />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /export csv/i }));
      await user.click(screen.getByText("Criteria"));
      await user.click(screen.getByRole("button", { name: /^export$/i }));

      expect(onExport).toHaveBeenCalledWith({ mode: "criteria" });
    });

    it("defaults to Full, the mode that answers the most questions", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<ExportSurface onExport={onExport} />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /export csv/i }));
      await user.click(screen.getByRole("button", { name: /^export$/i }));

      expect(onExport).toHaveBeenCalledWith({ mode: "full" });
    });
  });

  describe("when the panel says there is nothing to export", () => {
    /**
     * Deciding there is nothing to export belongs to the panel, and is pinned
     * against the real one in RunHistoryEmptyState. This covers the other half:
     * the bar honours the flag instead of rendering an enabled button anyway.
     */
    it("renders the button disabled", () => {
      render(<ExportSurface runCount={0} />, { wrapper: Wrapper });

      expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
    });

    it("leaves it clickable as soon as there are runs", () => {
      render(<ExportSurface runCount={1} />, { wrapper: Wrapper });

      expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled();
    });
  });

  describe("when an export is streaming", () => {
    /**
     * The count comes over a subscription because the response body is the file
     * itself. `aria-live` matters here: the number changes without any
     * interaction, so a screen reader is told rather than left on the stale
     * value.
     */
    /** @scenario Progress is shown while a large export streams */
    it("replaces the button with a live count and a way out", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={[]}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          onExport={vi.fn()}
          isExporting
          exportProgress={{ exported: 1200, total: 5000 }}
          onCancelExport={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.queryByRole("button", { name: /export csv/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/exporting 1,200 of 5,000 runs/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });

    /** @scenario Cancelling an in-flight export stops it */
    it("hands the cancel back to the caller that owns the request", async () => {
      const user = userEvent.setup();
      const onCancelExport = vi.fn();
      render(
        <RunHistoryFilters
          scenarioOptions={[]}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          onExport={vi.fn()}
          isExporting
          exportProgress={{ exported: 10, total: 5000 }}
          onCancelExport={onCancelExport}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onCancelExport).toHaveBeenCalledOnce();
    });

    it("says it is exporting even before the server reports a total", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={[]}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          onExport={vi.fn()}
          isExporting
          exportProgress={{ exported: 0, total: 0 }}
          onCancelExport={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText(/exporting…/i)).toBeInTheDocument();
    });
  });
});
