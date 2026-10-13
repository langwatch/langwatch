/**
 * The dataset header's add and edit-columns controls carry text labels rather than
 * being icon-only, so they are easy to find.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { DatasetTabs } from "../dataset-tabs.tsx";

const handlers = {
  onSelectExisting: vi.fn(),
  onUploadCSV: vi.fn(),
  onEditDataset: vi.fn(),
  onSaveAsDataset: vi.fn(),
};

describe("DatasetTabs", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the dataset header is rendered", () => {
    describe("when the header controls are shown", () => {
      /** @scenario Dataset header add and edit controls show text labels */
      it("labels the add and edit-columns controls with text, not icons alone", () => {
        renderWithDesignSystem(<DatasetTabs {...handlers} />);

        expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Edit columns" })).toBeInTheDocument();
      });
    });

    describe("when the edit-columns control is clicked", () => {
      it("invokes the edit-dataset handler", async () => {
        const user = userEvent.setup();
        renderWithDesignSystem(<DatasetTabs {...handlers} />);

        await user.click(screen.getByRole("button", { name: "Edit columns" }));

        expect(handlers.onEditDataset).toHaveBeenCalledOnce();
      });
    });
  });
});
