// @vitest-environment jsdom

/**
 * The shared confirmation modal that stands in for `window.confirm`, which is
 * a11y-hostile and not themable. These are the terms its call sites rely on:
 * what shows while it is open, which callback each button reaches, and what
 * the loading state refuses so a mutation cannot be double-submitted.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../src/components/confirm-dialog";
import { renderWithDesignSystem } from "../src/testing";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn<(open: boolean) => void>(),
  title: "Delete saved view",
  message: 'Delete "My View" saved view?',
  onConfirm: vi.fn<() => void>(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("ConfirmDialog", () => {
  describe("when open", () => {
    it("renders the title and message", async () => {
      renderWithDesignSystem(<ConfirmDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Delete saved view")).toBeTruthy();
        expect(screen.getByText('Delete "My View" saved view?')).toBeTruthy();
      });
    });

    it("uses the default confirm label when none is provided", async () => {
      renderWithDesignSystem(<ConfirmDialog {...defaultProps} />);

      expect(await screen.findByRole("button", { name: "Confirm" })).toBeTruthy();
    });

    it("renders a custom confirm label", async () => {
      renderWithDesignSystem(<ConfirmDialog {...defaultProps} confirmLabel="Delete" />);

      expect(await screen.findByRole("button", { name: "Delete" })).toBeTruthy();
    });
  });

  describe("when closed", () => {
    it("does not render the message", () => {
      renderWithDesignSystem(<ConfirmDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('Delete "My View" saved view?')).toBeNull();
    });
  });

  describe("when the confirm button is clicked", () => {
    it("calls onConfirm", async () => {
      const onConfirm = vi.fn<() => void>();
      renderWithDesignSystem(
        <ConfirmDialog {...defaultProps} confirmLabel="Delete" onConfirm={onConfirm} />,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the cancel button is clicked", () => {
    it("requests close via onOpenChange(false) without confirming", async () => {
      const onOpenChange = vi.fn<(open: boolean) => void>();
      const onConfirm = vi.fn<() => void>();
      renderWithDesignSystem(
        <ConfirmDialog
          {...defaultProps}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when loading", () => {
    it("disables the cancel button so the action cannot be aborted mid-flight", async () => {
      renderWithDesignSystem(<ConfirmDialog {...defaultProps} loading={true} />);

      const cancel = await screen.findByRole("button", { name: "Cancel" });
      expect((cancel as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("given a warning rather than a danger", () => {
    it("still asks the same question with the same two answers", async () => {
      renderWithDesignSystem(<ConfirmDialog {...defaultProps} tone="warning" />);

      expect(await screen.findByRole("button", { name: "Confirm" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });
  });
});
