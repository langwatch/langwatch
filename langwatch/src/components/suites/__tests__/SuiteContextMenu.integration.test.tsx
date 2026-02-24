/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteContextMenu component.
 *
 * Tests that the context menu renders Edit, Duplicate, and Archive actions,
 * fires the correct callbacks, and closes after action selection.
 *
 * @see specs/suites/suite-archiving.feature - "Archive a suite via the context menu"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiteContextMenu } from "../SuiteContextMenu";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
      render(<SuiteContextMenu {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.getByText("Edit")).toBeInTheDocument();
      expect(screen.getByText("Duplicate")).toBeInTheDocument();
      expect(screen.getByText("Archive")).toBeInTheDocument();
    });

    it("does not display a Delete action", () => {
      render(<SuiteContextMenu {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    });
  });

  describe("when Edit is clicked", () => {
    it("calls onEdit and onClose", async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      const onClose = vi.fn();

      render(
        <SuiteContextMenu {...defaultProps} onEdit={onEdit} onClose={onClose} />,
        { wrapper: Wrapper },
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

      render(
        <SuiteContextMenu
          {...defaultProps}
          onDuplicate={onDuplicate}
          onClose={onClose}
        />,
        { wrapper: Wrapper },
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

      render(
        <SuiteContextMenu
          {...defaultProps}
          onArchive={onArchive}
          onClose={onClose}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("Archive"));
      expect(onArchive).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
