/**
 * @vitest-environment jsdom
 *
 * The dataset header's add and edit-columns controls carry text labels rather
 * than being icon-only, so they are easy to find. See
 * dev/docs/best_practices/icon-button-labels.md.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetTabs } from "../components/DatasetSection/DatasetTabs";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
        render(<DatasetTabs {...handlers} />, { wrapper: Wrapper });

        expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Edit columns" }),
        ).toBeInTheDocument();
      });
    });

    describe("when the edit-columns control is clicked", () => {
      it("invokes the edit-dataset handler", async () => {
        const user = userEvent.setup();
        render(<DatasetTabs {...handlers} />, { wrapper: Wrapper });

        await user.click(screen.getByRole("button", { name: "Edit columns" }));

        expect(handlers.onEditDataset).toHaveBeenCalledOnce();
      });
    });
  });
});
