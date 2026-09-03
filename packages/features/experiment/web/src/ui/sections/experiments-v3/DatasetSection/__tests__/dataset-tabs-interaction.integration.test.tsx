import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * Switch Dataset on the active dataset tab.
 *
 * PORTED FROM `platform/app/src/experiments-v3/__tests__/DatasetTabsInteraction.integration.test.tsx`
 * (#7537), whose subject moved here with the workbench. The original rendered
 * the real Choose Dataset drawer beside the tabs; that drawer now belongs to
 * the dataset family and fetches its own rows, so the assertion stops at the
 * seam the workbench owns: the menu item calls the same handler the Add menu's
 * "Select existing dataset" does, which is what opens the picker
 * (`evaluations-v3-table.tsx` binds both to `openDrawer("selectDataset")`).
 *
 * @see specs/experiments-v3/dataset-management.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../../../../../behavior/experiments-v3/use-evaluations-v3-store";
import {
  type DatasetReference,
  DEFAULT_TEST_DATA_ID,
} from "../../../../../model/experiments-v3/types";
import { DatasetTabs } from "../dataset-tabs";

const onSelectExisting = vi.fn();
const onUploadCSV = vi.fn();
const onEditDataset = vi.fn();
const onSaveAsDataset = vi.fn();

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDatasetTabs = () =>
  render(
    <DatasetTabs
      onSelectExisting={onSelectExisting}
      onUploadCSV={onUploadCSV}
      onEditDataset={onEditDataset}
      onSaveAsDataset={onSaveAsDataset}
    />,
    { wrapper: Wrapper },
  );

const savedDataset = (id: string, name: string): DatasetReference => ({
  id,
  name,
  type: "saved",
  datasetId: `db-${id}`,
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "output", name: "output", type: "string" },
  ],
});

describe("DatasetTabs", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the active tab's menu is opened", () => {
    /** @scenario "Switching to another dataset from the active dataset's menu" */
    it("offers Switch Dataset", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`));

      await waitFor(() => {
        expect(screen.getByText("Switch Dataset")).toBeInTheDocument();
      });
    });

    /** @scenario "Switching to another dataset from the active dataset's menu" */
    it("opens the dataset picker when Switch Dataset is chosen", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`));
      await waitFor(() => {
        expect(screen.getByText("Switch Dataset")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Switch Dataset"));

      expect(onSelectExisting).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Switching to another dataset from the active dataset's menu" */
    it("offers Switch Dataset for a saved dataset too", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();
      store.addDataset(savedDataset("saved-ds", "Saved Dataset"));
      store.setActiveDataset("saved-ds");

      renderDatasetTabs();

      await user.click(screen.getByTestId("dataset-tab-saved-ds"));

      await waitFor(() => {
        expect(screen.getByText("Switch Dataset")).toBeInTheDocument();
        // Saving is for a workbench-local dataset; a saved one has nowhere to
        // save to, and switching is offered either way.
        expect(screen.queryByText("Save as dataset")).not.toBeInTheDocument();
      });
    });
  });
});
