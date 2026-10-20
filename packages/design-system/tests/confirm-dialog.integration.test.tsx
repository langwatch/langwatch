// @vitest-environment jsdom

/** The shared confirmation modal that stands in for `window.confirm`, which is a11y-hostile and not
 * themable. These are the terms its call sites rely on: what shows while it is open, which
 * callback each button reaches, and what the loading state refuses so a mutation cannot be
 * double-submitted. */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../src/components/overlays/confirm-dialog.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

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
        <ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} onConfirm={onConfirm} />,
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

/** A list whose rows can be deleted: the confirmation hands focus to whichever row survives. */
function Rows({
  onExitComplete = () => undefined,
  onConfirmed,
  initial = ["alpha", "beta"],
  loading = false,
}: {
  onExitComplete?: () => void;
  onConfirmed?: () => void;
  initial?: string[];
  loading?: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const target = useRef<string>("new");
  const container = useRef<HTMLDivElement>(null);
  const elementFor = (name: string) =>
    name === "new"
      ? document.querySelector<HTMLElement>('[data-testid="new"]')
      : container.current?.querySelector<HTMLElement>(`[data-row="${name}"]`);
  return (
    <div ref={container}>
      <button type="button" data-testid="new">
        New row
      </button>
      {rows.map((row) => (
        <button
          key={row}
          type="button"
          data-row={row}
          onClick={() => {
            target.current = row;
            setOpen(true);
          }}
        >
          {row}
        </button>
      ))}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete row?"
        description="It leaves the list."
        confirmLabel="Delete row"
        loading={loading}
        onConfirm={() => {
          onConfirmed?.();
          const index = rows.indexOf(target.current);
          target.current = rows[index + 1] ?? rows[index - 1] ?? "new";
          setRows((current) => current.filter((row) => row !== rows[index]));
          setOpen(false);
        }}
        finalFocusEl={() => elementFor(target.current) ?? null}
        onExitComplete={onExitComplete}
      />
    </div>
  );
}

describe("ConfirmDialog focus and exit", () => {
  /** @scenario Closing a confirmation hands focus to the element the caller names */
  it("returns focus to the named row on cancel, calling the exit callback once", async () => {
    const user = userEvent.setup();
    const onExitComplete = vi.fn<() => void>();
    renderWithDesignSystem(<Rows onExitComplete={onExitComplete} />);

    await user.click(screen.getByRole("button", { name: "beta" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "beta" })),
    );
    await waitFor(() => expect(onExitComplete).toHaveBeenCalledTimes(1));
  });

  /** @scenario Closing a confirmation hands focus to the element the caller names */
  it("moves focus to the surviving neighbour when the opener row is deleted", async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const onExitComplete = vi.fn<() => void>(() => events.push("exited"));
    renderWithDesignSystem(
      <Rows onExitComplete={onExitComplete} onConfirmed={() => events.push("confirmed")} />,
    );

    await user.click(screen.getByRole("button", { name: "alpha" }));
    await user.click(await screen.findByRole("button", { name: "Delete row" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "alpha" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "beta" })),
    );
    await waitFor(() => expect(events).toEqual(["confirmed", "exited"]));
  });

  /** @scenario Closing a confirmation hands focus to the element the caller names */
  it("falls back to the page action when the last row is deleted", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Rows initial={["alpha"]} />);

    await user.click(screen.getByRole("button", { name: "alpha" }));
    await user.click(await screen.findByRole("button", { name: "Delete row" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "New row" })),
    );
  });

  /** @scenario A confirmation that is not given a focus target or exit callback behaves as before */
  it("closes on cancel with neither prop given", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    renderWithDesignSystem(
      <ConfirmDialog
        open
        onClose={onClose}
        title="Delete row?"
        description="It leaves the list."
        onConfirm={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** @scenario A busy confirmation neither closes nor confirms again */
  it("neither closes on Escape nor confirms again while loading", async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn<() => void>();
    renderWithDesignSystem(<Rows loading onConfirmed={onConfirmed} />);

    await user.click(screen.getByRole("button", { name: "alpha" }));
    const confirm = await screen.findByRole("button", { name: "Delete row" });
    await user.click(confirm);
    await user.click(confirm);
    await user.keyboard("{Escape}");

    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
