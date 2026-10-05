/**
 * The export config dialog: how many runs it covers and the two export depths it offers.
 * @vitest-environment jsdom
 * @see specs/scenarios/scenario-run-export.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioRunExportDialog } from "../scenario-run-export-dialog.tsx";

afterEach(cleanup);

describe("<ScenarioRunExportDialog/>", () => {
  describe("when the dialog is open", () => {
    /** @scenario "The dialog offers both export depths" */
    it("offers Full and Criteria, each stating what one row represents", () => {
      renderWithDesignSystem(
        <ScenarioRunExportDialog
          isOpen
          onClose={vi.fn()}
          onExport={vi.fn()}
          runCount={12}
          hasFiltersApplied
        />,
      );

      expect(screen.getByRole("radio", { name: "Full" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Criteria" })).toBeInTheDocument();
      expect(screen.getByText("One row per message: the complete export")).toBeInTheDocument();
      expect(
        screen.getByText("One row per checklist item: rank what fails most"),
      ).toBeInTheDocument();
    });

    it("shows how many runs match the filters and defaults the mode to Full", async () => {
      const onExport = vi.fn();
      renderWithDesignSystem(
        <ScenarioRunExportDialog
          isOpen
          onClose={vi.fn()}
          onExport={onExport}
          runCount={12}
          hasFiltersApplied
        />,
      );

      expect(screen.getByText(/12 runs matching your filters/)).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Full" })).toBeChecked();

      await userEvent.setup().click(screen.getByRole("button", { name: /Export/ }));
      expect(onExport).toHaveBeenCalledWith({ mode: "full" });
    });
  });
});
