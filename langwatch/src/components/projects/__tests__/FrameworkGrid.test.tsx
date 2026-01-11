import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { FrameworkGrid } from "../FrameworkGrid";

// Mock the SelectableIconCard to avoid needing full Chakra setup
vi.mock(
  "../../../features/onboarding/components/sections/shared/SelectableIconCard",
  () => ({
    SelectableIconCard: ({
      label,
      selected,
      onClick,
      ariaLabel,
    }: {
      label: string;
      selected: boolean;
      onClick: () => void;
      ariaLabel: string;
    }) => (
      <button
        role="button"
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onClick}
        data-testid={`framework-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {label}
      </button>
    ),
  }),
);

describe("FrameworkGrid", () => {
  describe("when python is selected", () => {
    it("shows Python-compatible frameworks", () => {
      const onSelect = vi.fn();
      render(
        <FrameworkGrid
          selectedLanguage="python"
          selectedFramework="openai"
          onSelectFramework={onSelect}
        />,
      );

      expect(screen.getByTestId("framework-openai")).toBeInTheDocument();
      expect(screen.getByTestId("framework-langchain")).toBeInTheDocument();
      expect(screen.getByTestId("framework-dspy")).toBeInTheDocument();
    });

    it("does not show TypeScript-only frameworks", () => {
      const onSelect = vi.fn();
      render(
        <FrameworkGrid
          selectedLanguage="python"
          selectedFramework="openai"
          onSelectFramework={onSelect}
        />,
      );

      expect(
        screen.queryByTestId("framework-vercel-ai-sdk"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when typescript is selected", () => {
    it("shows TypeScript-compatible frameworks", () => {
      const onSelect = vi.fn();
      render(
        <FrameworkGrid
          selectedLanguage="typescript"
          selectedFramework="openai"
          onSelectFramework={onSelect}
        />,
      );

      expect(screen.getByTestId("framework-openai")).toBeInTheDocument();
      expect(screen.getByTestId("framework-vercel-ai-sdk")).toBeInTheDocument();
      expect(screen.getByTestId("framework-langchain")).toBeInTheDocument();
    });

    it("does not show Python-only frameworks", () => {
      const onSelect = vi.fn();
      render(
        <FrameworkGrid
          selectedLanguage="typescript"
          selectedFramework="openai"
          onSelectFramework={onSelect}
        />,
      );

      expect(screen.queryByTestId("framework-dspy")).not.toBeInTheDocument();
    });
  });

  describe("when clicking a framework card", () => {
    it("calls onSelectFramework with the framework key", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <FrameworkGrid
          selectedLanguage="python"
          selectedFramework="openai"
          onSelectFramework={onSelect}
        />,
      );

      await user.click(screen.getByTestId("framework-langchain"));

      expect(onSelect).toHaveBeenCalledWith("langchain");
    });
  });

  describe("when displaying selected state", () => {
    it("marks the selected framework as pressed", () => {
      const onSelect = vi.fn();
      render(
        <FrameworkGrid
          selectedLanguage="python"
          selectedFramework="langchain"
          onSelectFramework={onSelect}
        />,
      );

      expect(screen.getByTestId("framework-langchain")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("framework-openai")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  describe("when displaying section label", () => {
    it("shows Library or Framework text", () => {
      const onSelect = vi.fn();
      render(
        <FrameworkGrid
          selectedLanguage="python"
          selectedFramework="openai"
          onSelectFramework={onSelect}
        />,
      );

      expect(screen.getByText("Library or Framework")).toBeInTheDocument();
    });
  });
});
