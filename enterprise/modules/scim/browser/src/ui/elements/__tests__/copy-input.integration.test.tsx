// @vitest-environment jsdom
/**
 * Clicking a copy field the browser cannot copy from reports through feedback, and with no
 * working feedback host that report must not throw into the click handler.
 * @see specs/features/handled-error-presentation.feature
 */
import { UNAVAILABLE_UI_FEEDBACK } from "@langwatch/browser-host/capabilities";
import { setUiFeedbackHost } from "@langwatch/browser-host/toaster";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyInput } from "../copy-input.tsx";

afterEach(() => {
  setUiFeedbackHost(void 0);
  cleanup();
  vi.restoreAllMocks();
});

describe("CopyInput", () => {
  describe("given the browser has no clipboard and only the unavailable feedback host is mounted", () => {
    /** @scenario A copy helper keeps its promise when feedback is unavailable */
    it("warns instead of throwing when the field is clicked", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      setUiFeedbackHost(UNAVAILABLE_UI_FEEDBACK);

      render(
        <DesignSystemProvider>
          <CopyInput value="secret" label="token" />
        </DesignSystemProvider>,
      );

      expect(() => fireEvent.click(screen.getByDisplayValue("secret"))).not.toThrow();
      expect(warn).toHaveBeenCalled();
    });
  });
});
