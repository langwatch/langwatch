/**
 * SuiteContextMenu with Edit, Duplicate, and Archive actions.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuiteContextMenu } from "../../elements/dialogs/suite-context-menu.tsx";

const defaultProps = {
  x: 100,
  y: 200,
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onArchive: vi.fn(),
  onClose: vi.fn(),
};

describe("<SuiteContextMenu/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given the context menu is rendered", () => {
    it("displays Edit, Duplicate, and Archive actions", () => {
      renderWithDesignSystem(<SuiteContextMenu {...defaultProps} />);

      expect(screen.getByText("Edit")).toBeInTheDocument();
      expect(screen.getByText("Duplicate")).toBeInTheDocument();
      expect(screen.getByText("Archive")).toBeInTheDocument();
    });

    it("does not display a Delete action", () => {
      renderWithDesignSystem(<SuiteContextMenu {...defaultProps} />);

      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    });
  });

  describe("when Edit is clicked", () => {
    it("calls onEdit and onClose", async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      const onClose = vi.fn();

      renderWithDesignSystem(
        <SuiteContextMenu {...defaultProps} onEdit={onEdit} onClose={onClose} />,
      );

      await user.click(screen.getByText("Edit"));
      expect(onEdit).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("when Duplicate is clicked", () => {
    it("calls onDuplicate and onClose", async () => {
      const user = userEvent.setup();
      const onDuplicate = vi.fn();
      const onClose = vi.fn();

      renderWithDesignSystem(
        <SuiteContextMenu {...defaultProps} onDuplicate={onDuplicate} onClose={onClose} />,
      );

      await user.click(screen.getByText("Duplicate"));
      expect(onDuplicate).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("when Archive is clicked", () => {
    it("calls onArchive and onClose", async () => {
      const user = userEvent.setup();
      const onArchive = vi.fn();
      const onClose = vi.fn();

      renderWithDesignSystem(
        <SuiteContextMenu {...defaultProps} onArchive={onArchive} onClose={onClose} />,
      );

      await user.click(screen.getByText("Archive"));
      expect(onArchive).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("when clicking outside the menu", () => {
    it("calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      renderWithDesignSystem(
        <div>
          <span data-testid="outside">Outside</span>
          <SuiteContextMenu {...defaultProps} onClose={onClose} />
        </div>,
      );

      await user.click(screen.getByTestId("outside"));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
