/**
 * @vitest-environment jsdom
 *
 * Tests for TableSettingsMenu component (the toolbar "Run Options" menu).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableSettingsMenu } from "../components/TableSettingsMenu";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("TableSettingsMenu", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    // Set experiment slug so the Run via API automation entry shows
    useEvaluationsV3Store.setState({ experimentSlug: "test-slug" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("Rendering", () => {
    it("renders a Run Options button", () => {
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      expect(button).toBeInTheDocument();
      expect(screen.getByText("Run Options")).toBeInTheDocument();
    });

    it("opens popover when clicking the button", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Row height")).toBeInTheDocument();
      });
    });

    it("shows row height options", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Compact")).toBeInTheDocument();
        expect(screen.getByText("Fit")).toBeInTheDocument();
      });
    });

    it("shows the automation entry when experiment slug exists", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Run in CI/CD")).toBeInTheDocument();
        expect(
          screen.getByText("Execute from your pipeline"),
        ).toBeInTheDocument();
      });
    });

    it("hides the automation entry when no experiment slug", async () => {
      useEvaluationsV3Store.setState({ experimentSlug: undefined });
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Row height")).toBeInTheDocument();
      });
      expect(screen.queryByText("Run in CI/CD")).not.toBeInTheDocument();
    });
  });

  describe("Row height functionality", () => {
    it("clicking Fit changes row height mode to 'fit'", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      // Find the button containing "Fit" text
      const fitText = await screen.findByText("Fit");
      const fitButton = fitText.closest("button");
      expect(fitButton).not.toBeNull();
      await user.click(fitButton!);

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("fit");
    });

    it("clicking Compact changes row height mode back", async () => {
      useEvaluationsV3Store.getState().setRowHeightMode("fit");

      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      // Find the button containing "Compact" text
      const compactText = await screen.findByText("Compact");
      const compactButton = compactText.closest("button");
      expect(compactButton).not.toBeNull();
      await user.click(compactButton!);

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("compact");
    });
  });

  describe("Run via API dialog", () => {
    const openRunDialog = async () => {
      const user = userEvent.setup();
      const button = screen.getByRole("button", { name: /run options/i });
      await user.click(button);

      const cicdText = await screen.findByText("Run in CI/CD");
      const cicdButton = cicdText.closest("button");
      expect(cicdButton).not.toBeNull();
      await user.click(cicdButton!);

      return screen.findByRole("dialog");
    };

    it("opens the Run via API dialog when clicking Run in CI/CD", async () => {
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const dialog = await openRunDialog();
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText("Run via API")).toBeInTheDocument();
    });

    it("shows the Run via API snippet targeting the experiment run", async () => {
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const dialog = await openRunDialog();
      expect(dialog.textContent ?? "").toContain(
        'langwatch.experiment.run("test-slug"',
      );
    });

    it("shows Python, TypeScript and Shell language tabs", async () => {
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      await openRunDialog();
      expect(screen.getByText("Python")).toBeInTheDocument();
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(screen.getByText("Shell")).toBeInTheDocument();
    });

    it("shows the data-source picker", async () => {
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      await openRunDialog();
      expect(screen.getByTestId("run-via-api-data-source")).toBeInTheDocument();
    });
  });

  describe("disabled state", () => {
    it("disables button when disabled prop is true", () => {
      render(<TableSettingsMenu disabled />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      expect(button).toBeDisabled();
    });
  });

  describe("fit mode restriction", () => {
    it("disables Fit option when dataset has more than 100 rows", async () => {
      // Add a dataset with more than 100 rows
      useEvaluationsV3Store.setState({
        activeDatasetId: "large-dataset",
        datasets: [
          {
            id: "large-dataset",
            name: "Large Dataset",
            type: "inline",
            columns: [{ id: "col1", name: "input", type: "string" }],
            inline: {
              columns: [{ id: "col1", name: "input", type: "string" }],
              // Create 150 rows
              records: {
                col1: Array.from({ length: 150 }, (_, i) => `row ${i + 1}`),
              },
            },
          },
        ],
      });

      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Compact")).toBeInTheDocument();
      });

      // Find the button containing "Fit" text
      const fitText = await screen.findByText("Fit");
      const fitButton = fitText.closest("button");

      // Button should be disabled
      expect(fitButton).toBeDisabled();
    });

    it("does not change to fit mode when clicking disabled Fit option", async () => {
      // Add a dataset with more than 100 rows
      useEvaluationsV3Store.setState({
        activeDatasetId: "large-dataset",
        datasets: [
          {
            id: "large-dataset",
            name: "Large Dataset",
            type: "inline",
            columns: [{ id: "col1", name: "input", type: "string" }],
            inline: {
              columns: [{ id: "col1", name: "input", type: "string" }],
              records: {
                col1: Array.from({ length: 150 }, (_, i) => `row ${i + 1}`),
              },
            },
          },
        ],
      });

      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      const fitText = await screen.findByText("Fit");
      const fitButton = fitText.closest("button");

      // Try to click the disabled button
      await user.click(fitButton!);

      // Mode should still be compact
      const store = useEvaluationsV3Store.getState();
      expect(store.ui.rowHeightMode).toBe("compact");
    });

    it("allows Fit option when dataset has 100 or fewer rows", async () => {
      // Add a dataset with exactly 100 rows
      useEvaluationsV3Store.setState({
        activeDatasetId: "medium-dataset",
        datasets: [
          {
            id: "medium-dataset",
            name: "Medium Dataset",
            type: "inline",
            columns: [{ id: "col1", name: "input", type: "string" }],
            inline: {
              columns: [{ id: "col1", name: "input", type: "string" }],
              records: {
                col1: Array.from({ length: 100 }, (_, i) => `row ${i + 1}`),
              },
            },
          },
        ],
      });

      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", {
        name: /run options/i,
      });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Compact")).toBeInTheDocument();
      });

      // Find the button containing "Fit" text
      const fitText = await screen.findByText("Fit");
      const fitButton = fitText.closest("button");

      // Button should NOT be disabled
      expect(fitButton).not.toBeDisabled();

      // Click should work
      await user.click(fitButton!);
      const store = useEvaluationsV3Store.getState();
      expect(store.ui.rowHeightMode).toBe("fit");
    });
  });
});
