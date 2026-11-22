/**
 * Keyboard and focus behaviour measured in real Chromium,
 * which jsdom cannot compute.
 * @see packages/design-system/specs/design-system-boundary.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { SearchInput } from "../../src/components/forms/search-input.tsx";
import { CloseButton } from "../../src/components/overlays/close-button.tsx";
import { Dialog } from "../../src/components/overlays/dialog.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(() => {
  cleanup();
  document.body.removeAttribute("style");
});

function ModalFromTrigger() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button">Open settings</button>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Settings</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <input aria-label="First field" />
          <input aria-label="Second field" />
        </Dialog.Body>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

describe("a modal dialog opened from a keyboard control", () => {
  /** @scenario "Modal overlays are safe by default" */
  it("traps focus, blocks the background and returns focus to the trigger on close", async () => {
    renderWithDesignSystem(<ModalFromTrigger />);
    const trigger = screen.getByRole("button", { name: "Open settings" });

    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    for (let presses = 0; presses < 6; presses++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    expect(trigger.closest("[aria-hidden='true'], [inert]")).not.toBeNull();
    expect(getComputedStyle(document.body).overflow).toBe("hidden");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("shared controls reached from the keyboard", () => {
  /** @scenario "Shared controls expose accessible names and focus" */
  it("names the search input and the icon action and shows a visible focus indicator", async () => {
    const { container } = renderWithDesignSystem(
      <>
        <SearchInput />
        <CloseButton />
      </>,
    );

    const search = screen.getByRole("searchbox", { name: "Search" });
    const close = screen.getByRole("button", { name: "Close" });

    for (const control of [search, close]) {
      control.blur();
      await userEvent.tab();
      if (document.activeElement !== control) await userEvent.tab();
      expect(document.activeElement).toBe(control);

      const style = getComputedStyle(control);
      const outlined = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
      const shadowed = style.boxShadow !== "none";
      expect(outlined || shadowed).toBe(true);
    }

    const icons = [...container.querySelectorAll("svg")];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.closest("[aria-hidden='true']") ?? icon.getAttribute("aria-hidden")).toBeTruthy();
    }
  });
});
