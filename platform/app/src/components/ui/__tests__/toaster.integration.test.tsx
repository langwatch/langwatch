/**
 * @vitest-environment jsdom
 *
 * The base Toaster contract: every toast carries a close button (call sites
 * cannot opt out), and the toast region sits at the bottom center of the
 * screen so it never covers a drawer's close button.
 *
 * UX contract: specs/components/toasts.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { showErrorToast } from "~/features/errors/logic/showErrorToast";
import { Toaster, toaster } from "../toaster";

beforeEach(() => {
  toaster.remove();
});
afterEach(() => {
  cleanup();
  toaster.remove();
});

function mountToaster() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Toaster />
    </ChakraProvider>,
  );
}

function closeTriggerOf(toastEl: HTMLElement): HTMLElement | null {
  return toastEl.querySelector<HTMLElement>('[data-part="close-trigger"]');
}

describe("given the application renders the shared Toaster", () => {
  beforeEach(() => {
    mountToaster();
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
      fireEvent.click(closeTriggerOf(toastEl)!);

      await waitFor(() => {
        expect(screen.queryByText("Saved")).not.toBeInTheDocument();
      });
    });
  });

  describe("when an error is shown through the error toast helper", () => {
    /** @scenario "An error toast keeps its close button and error actions" */
    it("shows the close button, the docs link and the copyable error id", async () => {
      showErrorToast({
        error: {
          data: {
            error: {
              code: "query_timeout",
              httpStatus: 504,
              // `safeDocsUrl` accepts our own docs origins only, so the link
              // has to be one the server could really have sent.
              docsUrl: "https://docs.langwatch.ai/support",
              traceId: "trace_123",
            },
          },
        },
      });

      const toastEl = (await screen.findByText("This search took too long")).closest(
        '[data-part="root"]',
      ) as HTMLElement;
      expect(closeTriggerOf(toastEl)).not.toBeNull();
      // jsdom has no clipboard API, so ErrorActions falls back from the
      // "Copy error ID" button to showing the id as selectable text.
      expect(screen.getByText("Error ID: trace_123")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Read the docs/ })).toHaveAttribute(
        "href",
        "https://docs.langwatch.ai/support",
      );
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
