/**
 * @vitest-environment jsdom
 *
 * Save and Open, as a member meets them.
 *
 * The toolbar takes callbacks rather than a tRPC client, so these drive the
 * real component against the real Chakra menus and read what it asks for. The
 * claim that matters is the one a member would be hurt by getting wrong: that
 * Save with a chart open writes back to that chart instead of quietly leaving
 * them with two.
 *
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SavedChartsToolbar } from "../components/SavedChartsToolbar";

const withChakra = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

const CHARTS = [
  { id: "chart-1", name: "Traces per day" },
  { id: "chart-2", name: "Errors by model" },
];

function mount(
  overrides: Partial<Parameters<typeof SavedChartsToolbar>[0]> = {},
) {
  const handlers = {
    onSave: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onSaveAsNew: vi.fn(),
  };
  withChakra(
    <SavedChartsToolbar
      charts={CHARTS}
      openedChartId={null}
      openedChartName={null}
      isSaving={false}
      savable={true}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("the saved chart toolbar", () => {
  describe("given nothing is open yet", () => {
    describe("when the member saves", () => {
      /** @scenario "Save stores what is on screen, and saves again into the same chart" */
      it("asks for a name and creates a chart under it", async () => {
        const user = userEvent.setup();
        const handlers = mount();

        expect(screen.getByTestId("save-chart")).toHaveTextContent(
          "Save chart",
        );
        await user.click(screen.getByTestId("save-chart"));

        const field = await screen.findByLabelText("Chart name");
        await user.type(field, "Traces per day");
        await user.click(screen.getByRole("button", { name: "Save" }));

        expect(handlers.onSave).toHaveBeenCalledWith({
          name: "Traces per day",
        });
      });
    });

    describe("when the member has written nothing to save", () => {
      it("offers no save at all", () => {
        mount({ savable: false });
        expect(screen.getByTestId("save-chart")).toBeDisabled();
      });
    });
  });

  describe("given a chart is open", () => {
    describe("when the member saves again", () => {
      /** @scenario "Save stores what is on screen, and saves again into the same chart" */
      it("writes back to that chart without asking for a name again", async () => {
        const user = userEvent.setup();
        const handlers = mount({
          openedChartId: "chart-1",
          openedChartName: "Traces per day",
        });

        expect(screen.getByTestId("save-chart")).toHaveTextContent("Save");
        await user.click(screen.getByTestId("save-chart"));

        // No dialog, and no name — which is what makes this an update of the
        // open chart rather than a second one beside it.
        expect(handlers.onSave).toHaveBeenCalledWith({});
        expect(screen.queryByLabelText("Chart name")).toBeNull();
      });
    });

    describe("when the member renames or deletes it", () => {
      /** @scenario "A saved chart can be renamed or deleted from the list" */
      it("renames through the chart's own menu", async () => {
        const user = userEvent.setup();
        const handlers = mount({
          openedChartId: "chart-1",
          openedChartName: "Traces per day",
        });

        await user.click(screen.getByTestId("opened-chart-actions"));
        await user.click(await screen.findByText("Rename"));

        const field = await screen.findByLabelText("Chart name");
        await user.clear(field);
        await user.type(field, "Traces per week");
        await user.click(screen.getByRole("button", { name: "Save" }));

        expect(handlers.onRename).toHaveBeenCalledWith({
          id: "chart-1",
          name: "Traces per week",
        });
      });

      /** @scenario "A saved chart can be renamed or deleted from the list" */
      it("deletes through the same menu", async () => {
        const user = userEvent.setup();
        const handlers = mount({
          openedChartId: "chart-1",
          openedChartName: "Traces per day",
        });

        await user.click(screen.getByTestId("opened-chart-actions"));
        await user.click(await screen.findByText("Delete"));

        expect(handlers.onDelete).toHaveBeenCalledWith("chart-1");
      });
    });
  });

  describe("given the project has saved charts", () => {
    describe("when the member opens the list", () => {
      /** @scenario "Open restores a saved chart's query, parameters and specification" */
      it("lists them and opens the one that is picked", async () => {
        const user = userEvent.setup();
        const handlers = mount();

        await user.click(screen.getByTestId("open-saved-chart"));

        await waitFor(() =>
          expect(screen.getByText("Errors by model")).toBeInTheDocument(),
        );
        await user.click(screen.getByText("Traces per day"));

        expect(handlers.onOpen).toHaveBeenCalledWith("chart-1");
      });
    });
  });

  describe("given the project has no saved charts", () => {
    describe("when the member opens the list", () => {
      it("says so rather than showing an empty menu", async () => {
        const user = userEvent.setup();
        mount({ charts: [] });

        await user.click(screen.getByTestId("open-saved-chart"));

        expect(await screen.findByText("No saved charts yet")).toBeVisible();
      });
    });
  });
});
