/**
 * @vitest-environment jsdom
 *
 * Integration tests for TargetPicker's archived targets section.
 */

import type React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetPicker, type TargetPickerProps } from "../TargetPicker";

vi.mock("../ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange?: (details: { checked: boolean }) => void; children: React.ReactNode }) => (
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
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
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
      { type: "http" as const, referenceId: "agent_old", name: "agent_old" },
      { type: "prompt" as const, referenceId: "prompt_old", name: "prompt_old" },
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

      it("displays each archived target name", () => {
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
        expect(onRemove).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "http",
            referenceId: "agent_old",
          }),
        );
      });
    });
  });

  describe("given Select All and Clear buttons", () => {
    const targets = [
      { name: "Agent 1", type: "http" as const, referenceId: "agent_1" },
      { name: "Agent 2", type: "http" as const, referenceId: "agent_2" },
      { name: "Prompt 1", type: "prompt" as const, referenceId: "prompt_1" },
    ];

    describe("when the picker renders with onSelectAll and onClear", () => {
      it("displays a Select All button in the footer", () => {
        renderPicker({ targets, totalCount: 3, onSelectAll: vi.fn(), onClear: vi.fn() });

        expect(screen.getByRole("button", { name: "Select All" })).toBeInTheDocument();
      });

      it("displays a Clear button in the footer", () => {
        renderPicker({ targets, totalCount: 3, onSelectAll: vi.fn(), onClear: vi.fn() });

        expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
      });

      it("displays the selection count", () => {
        renderPicker({
          targets,
          totalCount: 3,
          onSelectAll: vi.fn(),
          onClear: vi.fn(),
          selectedTargets: [
            { type: "http", referenceId: "agent_1" },
            { type: "prompt", referenceId: "prompt_1" },
          ],
        });

        expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
      });
    });

    describe("when Select All is clicked", () => {
      it("calls onSelectAll", async () => {
        const onSelectAll = vi.fn();
        const user = userEvent.setup();

        renderPicker({ targets, totalCount: 3, onSelectAll });

        await user.click(screen.getByRole("button", { name: "Select All" }));

        expect(onSelectAll).toHaveBeenCalledTimes(1);
      });
    });

    describe("when Clear is clicked", () => {
      it("calls onClear", async () => {
        const onClear = vi.fn();
        const user = userEvent.setup();

        renderPicker({ targets, totalCount: 3, onClear });

        await user.click(screen.getByRole("button", { name: "Clear" }));

        expect(onClear).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a single archived target", () => {
    describe("when the picker renders", () => {
      it("uses singular text for the warning", () => {
        renderPicker({
          archivedTargets: [{ type: "http", referenceId: "agent_old", name: "agent_old" }],
        });

        expect(
          screen.getByText("1 archived target linked:"),
        ).toBeInTheDocument();
      });
    });
  });
});
