/**
 * @vitest-environment jsdom
 *
 * The autosave indicator stays out of the way at rest: it shows nothing while
 * idle and only surfaces while saving, on success, or on failure. A standalone
 * resting icon read as confusing chrome, so the idle state renders nothing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SaveStatusChip } from "../DatasetEditorTable";

const renderChip = (props: Parameters<typeof SaveStatusChip>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SaveStatusChip {...props} />
    </ChakraProvider>,
  );

describe("SaveStatusChip", () => {
  afterEach(() => cleanup());

  describe("when the editor is idle", () => {
    it("renders no indicator at all", () => {
      renderChip({ state: "idle" });

      expect(screen.queryByTestId("save-status-idle")).toBeNull();
      expect(screen.queryByTestId("save-status-saving")).toBeNull();
      expect(screen.queryByTestId("save-status-saved")).toBeNull();
      expect(screen.queryByTestId("save-status-error")).toBeNull();
    });
  });

  describe("when a save is in progress", () => {
    it("shows the saving indicator", () => {
      renderChip({ state: "saving" });

      expect(screen.getByTestId("save-status-saving")).toBeInTheDocument();
      expect(screen.getByText("Saving…")).toBeInTheDocument();
    });
  });

  describe("when a save just succeeded", () => {
    it("shows the saved indicator", () => {
      renderChip({ state: "saved" });

      expect(screen.getByTestId("save-status-saved")).toBeInTheDocument();
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  describe("when a save failed", () => {
    it("shows the error indicator", () => {
      renderChip({ state: "error", error: "boom" });

      expect(screen.getByTestId("save-status-error")).toBeInTheDocument();
      expect(screen.getByText("Failed to save")).toBeInTheDocument();
    });
  });
});
