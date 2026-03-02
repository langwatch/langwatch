/**
 * @vitest-environment jsdom
 *
 * Integration tests for TargetPicker's archived targets section.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetPicker, type TargetPickerProps } from "../TargetPicker";

vi.mock("../ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, children }: any) => (
    <label>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={() => onCheckedChange?.({ checked: !checked })}
      />
      {children}
    </label>
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderPicker(overrides: Partial<TargetPickerProps> = {}) {
  const defaultProps: TargetPickerProps = {
    targets: [{ name: "Prod Agent", type: "http", referenceId: "agent_1" }],
    selectedTargets: [{ type: "http", referenceId: "agent_1" }],
    totalCount: 1,
    isTargetSelected: () => true,
    onToggle: vi.fn(),
    searchQuery: "",
    onSearchChange: vi.fn(),
    onCreateAgent: vi.fn(),
    onCreatePrompt: vi.fn(),
    ...overrides,
  };
  return render(<TargetPicker {...defaultProps} />, { wrapper: Wrapper });
}

describe("<TargetPicker />", () => {
  afterEach(cleanup);

  describe("given no archived targets", () => {
    describe("when the picker renders", () => {
      it("does not show the archived-targets section", () => {
        renderPicker({ archivedTargets: [] });

        expect(
          screen.queryByTestId("archived-targets-section"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given archived targets are present", () => {
    const archivedTargets = [
      { type: "http" as const, referenceId: "agent_old" },
      { type: "prompt" as const, referenceId: "prompt_old" },
    ];

    describe("when the picker renders", () => {
      it("shows the archived-targets warning section", () => {
        renderPicker({ archivedTargets });

        expect(
          screen.getByTestId("archived-targets-section"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("2 archived targets linked:"),
        ).toBeInTheDocument();
      });

      it("displays each archived target reference ID", () => {
        renderPicker({ archivedTargets });

        expect(screen.getByText("agent_old")).toBeInTheDocument();
        expect(screen.getByText("prompt_old")).toBeInTheDocument();
      });

      it("renders a Remove button for each archived target", () => {
        renderPicker({
          archivedTargets,
          onRemoveArchived: vi.fn(),
        });

        expect(
          screen.getByTestId("remove-archived-target-agent_old"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("remove-archived-target-prompt_old"),
        ).toBeInTheDocument();
      });
    });

    describe("when the Remove button is clicked", () => {
      it("calls onRemoveArchived with the correct target", async () => {
        const onRemove = vi.fn();
        const user = userEvent.setup();

        renderPicker({
          archivedTargets,
          onRemoveArchived: onRemove,
        });

        await user.click(
          screen.getByTestId("remove-archived-target-agent_old"),
        );

        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove).toHaveBeenCalledWith({
          type: "http",
          referenceId: "agent_old",
        });
      });
    });
  });

  describe("given a single archived target", () => {
    describe("when the picker renders", () => {
      it("uses singular text for the warning", () => {
        renderPicker({
          archivedTargets: [{ type: "http", referenceId: "agent_old" }],
        });

        expect(
          screen.getByText("1 archived target linked:"),
        ).toBeInTheDocument();
      });
    });
  });
});
