import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { LanguageGrid } from "../LanguageGrid";

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
        data-testid={`language-${label.toLowerCase()}`}
      >
        {label}
      </button>
    ),
  }),
);

describe("LanguageGrid", () => {
  describe("when rendered with python selected", () => {
    it("displays Python as selected", () => {
      const onSelect = vi.fn();
      render(
        <LanguageGrid selectedLanguage="python" onSelectLanguage={onSelect} />,
      );

      const pythonCard = screen.getByTestId("language-python");
      expect(pythonCard).toHaveAttribute("aria-pressed", "true");
    });

    it("displays TypeScript as not selected", () => {
      const onSelect = vi.fn();
      render(
        <LanguageGrid selectedLanguage="python" onSelectLanguage={onSelect} />,
      );

      const tsCard = screen.getByTestId("language-typescript");
      expect(tsCard).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("when clicking a language card", () => {
    it("calls onSelectLanguage with the language key", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <LanguageGrid selectedLanguage="python" onSelectLanguage={onSelect} />,
      );

      await user.click(screen.getByTestId("language-typescript"));

      expect(onSelect).toHaveBeenCalledWith("typescript");
    });
  });

  describe("when displaying all options", () => {
    it("shows Python, TypeScript, and Other", () => {
      const onSelect = vi.fn();
      render(
        <LanguageGrid selectedLanguage="python" onSelectLanguage={onSelect} />,
      );

      expect(screen.getByTestId("language-python")).toBeInTheDocument();
      expect(screen.getByTestId("language-typescript")).toBeInTheDocument();
      expect(screen.getByTestId("language-other")).toBeInTheDocument();
    });

    it("shows the section label", () => {
      const onSelect = vi.fn();
      render(
        <LanguageGrid selectedLanguage="python" onSelectLanguage={onSelect} />,
      );

      expect(
        screen.getByText("Select your platform or language"),
      ).toBeInTheDocument();
    });
  });
});
