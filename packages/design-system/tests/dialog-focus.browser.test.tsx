/// <reference types="@vitest/browser-playwright" />
/**
 * Where focus goes when a dialog with no field and no Cancel opens, in real Chromium: inside the
 * dialog at once, kept there by Tab and Shift+Tab, and returned to the opener on close.
 * @see packages/design-system/specs/overlay-shapes.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Dialog } from "../src/components/overlays/dialog.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

beforeEach(async () => {
  await page.viewport(1000, 700);
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

interface HarnessProps {
  trapFocus?: boolean;
  initialFocusEl?: () => HTMLElement | null;
  withLink?: boolean;
  showCloseButton?: boolean;
}

function Harness({ trapFocus, initialFocusEl, withLink = true, showCloseButton }: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">Before</button>
      <button type="button" onClick={() => setOpen(true)}>
        Open snippet
      </button>
      <button type="button">After</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="API snippet"
        description="Copy the snippet"
        cancelLabel={null}
        trapFocus={trapFocus}
        initialFocusEl={initialFocusEl}
        showCloseButton={showCloseButton}
      >
        {withLink ? <a href="#docs">Read the docs</a> : <p>Read only text</p>}
        <div role="tablist">
          <button type="button" role="tab">
            Python
          </button>
          <button type="button" role="tab">
            Go
          </button>
        </div>
      </Dialog>
    </>
  );
}

const inside = () => {
  const dialog = screen.getByRole("dialog");
  return dialog.contains(document.activeElement);
};

async function openIt() {
  await userEvent.click(screen.getByRole("button", { name: "Open snippet" }));
  await screen.findByRole("dialog");
}

describe("Dialog initial focus and trap", () => {
  describe("when a dialog has no field and no Cancel", () => {
    /** @scenario "A dialog with no field and no Cancel still takes and holds focus" */
    it("moves focus into the dialog without a click inside", async () => {
      renderWithDesignSystem(<Harness />);
      await openIt();
      await waitFor(() => expect(inside()).toBe(true));
    });

    /** @scenario "A dialog with no field and no Cancel still takes and holds focus" */
    it("keeps focus inside through more than a full Tab cycle both ways", async () => {
      renderWithDesignSystem(<Harness />);
      await openIt();
      await waitFor(() => expect(inside()).toBe(true));
      for (let i = 0; i < 8; i++) {
        await userEvent.tab();
        expect(inside()).toBe(true);
      }
      for (let i = 0; i < 8; i++) {
        await userEvent.tab({ shift: true });
        expect(inside()).toBe(true);
      }
    });

    it("pulls programmatic outside focus back in", async () => {
      renderWithDesignSystem(<Harness />);
      await openIt();
      await waitFor(() => expect(inside()).toBe(true));
      screen.getByRole("button", { name: "After", hidden: true }).focus();
      await waitFor(() => expect(inside()).toBe(true));
    });

    it("returns focus to the opener on Escape and works again on reopen", async () => {
      renderWithDesignSystem(<Harness />);
      await openIt();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open snippet" })),
      );
      await openIt();
      await waitFor(() => expect(inside()).toBe(true));
    });
  });

  describe("when the dialog is read-only text with the X hidden", () => {
    it("still holds focus on the dialog itself", async () => {
      renderWithDesignSystem(<Harness withLink={false} showCloseButton={false} />);
      await openIt();
      await waitFor(() => expect(inside()).toBe(true));
    });
  });

  describe("when an explicit initial target is given", () => {
    it("focuses a usable explicit target", async () => {
      renderWithDesignSystem(
        <Harness initialFocusEl={() => screen.getByRole("tab", { name: "Go" })} />,
      );
      await openIt();
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Go" })),
      );
    });

    /** @scenario "A dialog with no field and no Cancel still takes and holds focus" */
    it("falls back safely when the explicit target is unavailable", async () => {
      renderWithDesignSystem(<Harness initialFocusEl={() => null} />);
      await openIt();
      await waitFor(() => expect(inside()).toBe(true));
    });
  });

  describe("when the trap is turned off", () => {
    it("does not pull outside focus back in", async () => {
      renderWithDesignSystem(<Harness trapFocus={false} />);
      await openIt();
      screen.getByRole("button", { name: "After", hidden: true }).focus();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "After", hidden: true }),
      );
    });
  });
});
