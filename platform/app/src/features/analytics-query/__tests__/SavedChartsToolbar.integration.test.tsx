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
 * @see specs/analytics/lwql-saved-charts.feature
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

function mount(overrides: Partial<Parameters<typeof SavedChartsToolbar>[0]> = {}) {
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
      canSave={true}
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

        expect(screen.getByTestId("save-chart")).toHaveTextContent("Save chart");
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
        mount({ canSave: false });
        expect(screen.getByTestId("save-chart")).toBeDisabled();
      });
    });

    describe("when they abandon one name and start over", () => {
      it("asks again with an empty field, not the abandoned text", async () => {
        const user = userEvent.setup();
        mount();

        await user.click(screen.getByTestId("save-chart"));
        await user.type(await screen.findByLabelText("Chart name"), "Half a thought");
        await user.click(screen.getByRole("button", { name: "Close" }));
        await waitFor(() => expect(screen.queryByLabelText("Chart name")).toBeNull());

        await user.click(screen.getByTestId("save-chart"));

        expect(await screen.findByLabelText("Chart name")).toHaveValue("");
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

        // Anchored: `toHaveTextContent("Save")` matches "Save chart" too, and
        // the label IS the claim — with a chart open the button must not read
        // as "create another".
        expect(screen.getByTestId("save-chart")).toHaveTextContent(/^Save$/);
        await user.click(screen.getByTestId("save-chart"));

        // No dialog, and no name — which is what makes this an update of the
        // open chart rather than a second one beside it.
        expect(handlers.onSave).toHaveBeenCalledWith({});
        expect(screen.queryByLabelText("Chart name")).toBeNull();
      });
    });

    describe("when the member renames or deletes it", () => {
      /** @scenario "A saved chart can be renamed or deleted from the list" */
      it("renames through the chart's own menu, starting from the name it has", async () => {
        const user = userEvent.setup();
        const handlers = mount({
          openedChartId: "chart-1",
          openedChartName: "Traces per day",
        });

        await user.click(screen.getByTestId("opened-chart-actions"));
        await user.click(await screen.findByText("Rename"));

        // Renaming edits a name that already exists. An empty field would make
        // the member retype it, and the one they retype is the one that sticks.
        const field = await screen.findByLabelText("Chart name");
        expect(field).toHaveValue("Traces per day");

        await user.clear(field);
        await user.type(field, "Traces per week");
        await user.click(screen.getByRole("button", { name: "Save" }));

        expect(handlers.onRename).toHaveBeenCalledWith({
          id: "chart-1",
          name: "Traces per week",
        });
      });

      /**
       * The menu that opens this dialog is only rendered while a chart is
       * open, but the parent's state can change under the open dialog. Falling
       * through to Save would answer "rename this chart" by creating a second
       * one — the exact outcome the rest of this file exists to prevent.
       *
       * @scenario "A saved chart can be renamed or deleted from the list"
       */
      it("refuses the rename, rather than saving a new chart, when the chart closes under the dialog", async () => {
        const user = userEvent.setup();
        const handlers = {
          onSave: vi.fn(),
          onOpen: vi.fn(),
          onRename: vi.fn(),
          onDelete: vi.fn(),
          onSaveAsNew: vi.fn(),
        };
        const toolbar = (openedChartId: string | null) => (
          <ChakraProvider value={defaultSystem}>
            <SavedChartsToolbar
              charts={CHARTS}
              openedChartId={openedChartId}
              openedChartName={openedChartId === null ? null : "Traces per day"}
              isSaving={false}
              canSave={true}
              {...handlers}
            />
          </ChakraProvider>
        );

        const { rerender } = render(toolbar("chart-1"));

        await user.click(screen.getByTestId("opened-chart-actions"));
        await user.click(await screen.findByText("Rename"));
        const field = await screen.findByLabelText("Chart name");

        // The chart closes while the dialog is still up.
        rerender(toolbar(null));

        await user.clear(field);
        await user.type(field, "Traces per week");
        await user.click(screen.getByRole("button", { name: "Save" }));

        expect(handlers.onRename).not.toHaveBeenCalled();
        expect(handlers.onSave).not.toHaveBeenCalled();
      });

      /** @scenario "A saved chart can be renamed or deleted from the list" */
      it("deletes through the same menu, once the member confirms", async () => {
        const user = userEvent.setup();
        const handlers = mount({
          openedChartId: "chart-1",
          openedChartName: "Traces per day",
        });

        await user.click(screen.getByTestId("opened-chart-actions"));
        await user.click(await screen.findByText("Delete"));

        // The menu click asks the question; it does not answer it.
        expect(handlers.onDelete).not.toHaveBeenCalled();

        await user.click(await screen.findByRole("button", { name: "Delete" }));

        expect(handlers.onDelete).toHaveBeenCalledWith("chart-1");
      });

      /** @scenario "Save as a new chart leaves the one that was open alone" */
      it("detaches the open chart when they ask for a new one", async () => {
        const user = userEvent.setup();
        const handlers = mount({
          openedChartId: "chart-1",
          openedChartName: "Traces per day",
        });

        await user.click(screen.getByTestId("opened-chart-actions"));
        await user.click(await screen.findByText("Save as a new chart"));

        // Nothing is written yet — the next Save is what creates it, and it
        // creates rather than updates because nothing is open any more.
        expect(handlers.onSaveAsNew).toHaveBeenCalled();
        expect(handlers.onSave).not.toHaveBeenCalled();
      });

      it("destroys nothing when the member backs out of the confirmation", async () => {
        const user = userEvent.setup();
        const handlers = mount({
          openedChartId: "chart-1",
          openedChartName: "Traces per day",
        });

        await user.click(screen.getByTestId("opened-chart-actions"));
        await user.click(await screen.findByText("Delete"));
        await user.click(await screen.findByRole("button", { name: "Cancel" }));

        expect(handlers.onDelete).not.toHaveBeenCalled();
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
