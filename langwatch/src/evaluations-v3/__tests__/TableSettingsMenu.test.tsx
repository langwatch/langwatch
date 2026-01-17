/**
 * @vitest-environment jsdom
 *
 * Tests for TableSettingsMenu component.
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
    // Set experiment slug so CI/CD option shows
    useEvaluationsV3Store.setState({ experimentSlug: "test-slug" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("Rendering", () => {
    it("renders a settings button", () => {
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      expect(button).toBeInTheDocument();
    });

    it("opens popover when clicking the button", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Row height")).toBeInTheDocument();
      });
    });

    it("shows row height options", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Compact")).toBeInTheDocument();
        expect(screen.getByText("Expanded")).toBeInTheDocument();
      });
    });

    it("shows CI/CD option when experiment slug exists", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Run in CI/CD")).toBeInTheDocument();
        expect(
          screen.getByText("Execute from your pipeline"),
        ).toBeInTheDocument();
      });
    });

    it("hides CI/CD option when no experiment slug", async () => {
      useEvaluationsV3Store.setState({ experimentSlug: undefined });
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText("Row height")).toBeInTheDocument();
      });
      expect(screen.queryByText("Run in CI/CD")).not.toBeInTheDocument();
    });
  });

  describe("Row height functionality", () => {
    it("clicking Expanded changes row height mode", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      const expandedButton = await screen.findByRole("button", {
        name: /expanded/i,
      });
      await user.click(expandedButton);

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("expanded");
    });

    it("clicking Compact changes row height mode back", async () => {
      useEvaluationsV3Store.getState().setRowHeightMode("expanded");

      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      const compactButton = await screen.findByRole("button", {
        name: /compact/i,
      });
      await user.click(compactButton);

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("compact");
    });
  });

  describe("CI/CD dialog", () => {
    it("opens CI/CD dialog when clicking Run in CI/CD", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      // Open settings menu
      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      // Click CI/CD option
      const cicdButton = await screen.findByText("Run in CI/CD");
      await user.click(cicdButton);

      // Dialog should open with title
      await waitFor(() => {
        // Dialog has same title as button, so we look for the dialog element
        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeInTheDocument();
      });
    });

    it("closes popover when opening CI/CD dialog", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      // Open settings menu
      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      // Verify popover is open (trigger has aria-expanded="true")
      await waitFor(() => {
        expect(button).toHaveAttribute("aria-expanded", "true");
      });

      // Click CI/CD option
      const cicdButton = await screen.findByText("Run in CI/CD");
      await user.click(cicdButton);

      // Dialog should open and popover should close
      await waitFor(() => {
        // The popover trigger should have aria-expanded="false" when closed
        expect(button).toHaveAttribute("aria-expanded", "false");
      });
    });

    it("shows code snippet area", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      const cicdButton = await screen.findByText("Run in CI/CD");
      await user.click(cicdButton);

      // Look for the API key instruction which is always shown
      await waitFor(() => {
        expect(screen.getByText(/LANGWATCH_API_KEY/)).toBeInTheDocument();
      });
    });

    it("shows language selector defaulting to Python", async () => {
      const user = userEvent.setup();
      render(<TableSettingsMenu />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      await user.click(button);

      const cicdButton = await screen.findByText("Run in CI/CD");
      await user.click(cicdButton);

      await waitFor(() => {
        // Language selector button should show "Python" as default
        expect(
          screen.getByRole("button", { name: /select language/i }),
        ).toHaveTextContent("Python");
      });
    });
  });

  describe("disabled state", () => {
    it("disables button when disabled prop is true", () => {
      render(<TableSettingsMenu disabled />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /table settings/i });
      expect(button).toBeDisabled();
    });
  });
});
