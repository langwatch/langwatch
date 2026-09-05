// @vitest-environment jsdom

/**
 * The base Toaster contract: every toast carries a close button (call sites
 * cannot opt out), and the toast region sits at the bottom center of the
 * screen so it never covers a drawer's close button.
 *
 * UX contract: specs/components/toasts.feature.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Toaster, toaster } from "../src/components/toaster";
import { renderWithDesignSystem } from "../src/testing";

beforeEach(() => {
  toaster.remove();
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

function closeTriggerOf(toastEl: HTMLElement): HTMLElement | null {
  return toastEl.querySelector<HTMLElement>('[data-part="close-trigger"]');
}

describe("given the application renders the shared Toaster", () => {
  beforeEach(() => {
    renderWithDesignSystem(<Toaster />);
  });

  describe("when a toast is created without extra options", () => {
    /** @scenario "Every toast shows a close button" */
    it("shows a close button", async () => {
      toaster.create({ title: "Saved" });

      const toastEl = (await screen.findByText("Saved")).closest(
        '[data-part="root"]',
      ) as HTMLElement;
      expect(closeTriggerOf(toastEl)).not.toBeNull();
    });

    /** @scenario "The close button dismisses the toast" */
    it("dismisses the toast when the close button is clicked", async () => {
      toaster.create({ title: "Saved" });

      const toastEl = (await screen.findByText("Saved")).closest(
        '[data-part="root"]',
      ) as HTMLElement;
      const closeTrigger = closeTriggerOf(toastEl)!;
      fireEvent.pointerDown(closeTrigger);
      fireEvent.pointerUp(closeTrigger);
      fireEvent.click(closeTrigger);

      // The toast leaves on an exit animation, so the tree still holds it
      // for a beat after the close lands. Its own state is what says the
      // close button dismissed it.
      await waitFor(() => {
        expect(toastEl.getAttribute("data-state")).toBe("closed");
      });
    });
  });

  describe("when any toast is created", () => {
    /** @scenario "Toasts appear at the bottom center of the screen" */
    it("places the toast region at the bottom center", async () => {
      toaster.create({ title: "Saved" });
      await screen.findByText("Saved");

      const region = document.querySelector('[data-part="group"]');
      expect(region).not.toBeNull();
      expect(region?.getAttribute("data-placement")).toBe("bottom");
    });
  });
});
