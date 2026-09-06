// @vitest-environment jsdom

/**
 * The application's error toast: the close button every toast carries, plus
 * the docs page and error id a failure gets through `renderMeta`.
 * UX contract: specs/components/toasts.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { toaster } from "@langwatch/design-system/toaster";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BrowserUiFeedback } from "../src/behavior/ui-feedback";
import { UiErrorToaster } from "../src/ui/elements/ui-error-toaster";

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

/** A handled refusal as the boundary serialises it onto a tRPC envelope. */
const TIMED_OUT_SEARCH = {
  data: {
    error: {
      code: "query_timeout",
      httpStatus: 504,
      // The link has to be one the server could really have sent.
      docsUrl: "https://docs.langwatch.ai/support",
      traceId: "trace_123",
    },
  },
};

describe("given the application renders its error toaster", () => {
  beforeEach(() => {
    render(
      <ChakraProvider value={defaultSystem}>
        <UiErrorToaster />
      </ChakraProvider>,
    );
  });

  describe("when a failure is reported through the feedback capability", () => {
    /** @scenario "An error toast keeps its close button and error actions" */
    it("shows the close button, the docs link and the copyable error id", async () => {
      BrowserUiFeedback.create().failed({
        error: TIMED_OUT_SEARCH,
        fallbackTitle: "Couldn't run your search",
      });

      const toastEl = (await screen.findByText("This search took too long")).closest(
        '[data-part="root"]',
      ) as HTMLElement;
      expect(closeTriggerOf(toastEl)).not.toBeNull();
      // jsdom defines `navigator` without a clipboard, so the actions fall back
      // from the "Copy error ID" button to showing the id as selectable text.
      expect(screen.getByText(/trace_123/).textContent).toContain("trace_123");
      expect(screen.getByRole("link", { name: /docs/i }).getAttribute("href")).toBe(
        "https://docs.langwatch.ai/support",
      );
    });
  });
});
