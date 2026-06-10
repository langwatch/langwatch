/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditableHeading } from "../EditableHeading";

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("EditableHeading", () => {
  const mockOnSave = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when loading", () => {
    it("does not show the value when isLoading is true", () => {
      renderWithProviders(
        <EditableHeading value="My Evaluation" onSave={mockOnSave} isLoading />,
      );

      expect(screen.queryByText("My Evaluation")).not.toBeInTheDocument();
    });

    it("shows the value when isLoading is false", () => {
      renderWithProviders(
        <EditableHeading
          value="My Evaluation"
          onSave={mockOnSave}
          isLoading={false}
        />,
      );

      expect(screen.getByText("My Evaluation")).toBeInTheDocument();
    });
  });

  describe("when displaying", () => {
    it("shows the value when provided", () => {
      renderWithProviders(
        <EditableHeading value="My Evaluation" onSave={mockOnSave} />,
      );

      expect(screen.getByText("My Evaluation")).toBeInTheDocument();
    });

    it("shows pencil icon on hover", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="My Evaluation" onSave={mockOnSave} />,
      );

      const heading = screen.getByText("My Evaluation").parentElement!;
      await user.hover(heading);

      // The edit icon should exist (it's always in DOM but with opacity 0 until hover)
      expect(heading.querySelector(".edit-icon")).toBeInTheDocument();
    });
  });

  describe("when clicking to edit", () => {
    it("shows input field after clicking", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="My Evaluation" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("My Evaluation"));

      expect(screen.getByRole("textbox")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toHaveValue("My Evaluation");
    });

    it("focuses and selects the input text", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="My Evaluation" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("My Evaluation"));

      const input = screen.getByRole("textbox");
      expect(document.activeElement).toBe(input);
    });
  });

  describe("when saving changes", () => {
    it("calls onSave when pressing Enter with new value", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Old Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Old Name"));
      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "New Name");
      await user.keyboard("{Enter}");

      expect(mockOnSave).toHaveBeenCalledWith("New Name");
    });

    it("calls onSave when blurring with new value", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Old Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Old Name"));
      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "New Name");
      await user.tab(); // blur the input

      expect(mockOnSave).toHaveBeenCalledWith("New Name");
    });

    it("does not call onSave when value is unchanged", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Same Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Same Name"));
      await user.keyboard("{Enter}");

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it("does not call onSave when value is only whitespace", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Old Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Old Name"));
      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "   ");
      await user.keyboard("{Enter}");

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it("trims whitespace from saved value", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Old Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Old Name"));
      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "  New Name  ");
      await user.keyboard("{Enter}");

      expect(mockOnSave).toHaveBeenCalledWith("New Name");
    });

    it("returns to display mode after saving", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Old Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Old Name"));
      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "New Name");
      await user.keyboard("{Enter}");

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("when cancelling edit", () => {
    it("does not call onSave when pressing Escape", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Old Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Old Name"));
      const input = screen.getByRole("textbox");
      await user.clear(input);
      await user.type(input, "New Name");
      await user.keyboard("{Escape}");

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it("returns to display mode when pressing Escape", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <EditableHeading value="Old Name" onSave={mockOnSave} />,
      );

      await user.click(screen.getByText("Old Name"));
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByText("Old Name")).toBeInTheDocument();
    });
  });
});
