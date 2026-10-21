// @vitest-environment jsdom
/**
 * The copy helper promises a boolean, whether or not a working feedback host is mounted.
 * @see specs/features/handled-error-presentation.feature
 */
import { UNAVAILABLE_UI_FEEDBACK } from "@langwatch/browser-host/capabilities";
import { setUiFeedbackHost } from "@langwatch/browser-host/toaster";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyToClipboard } from "../copy-to-clipboard.ts";

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  setUiFeedbackHost(void 0);
  vi.restoreAllMocks();
});

describe("copyToClipboard", () => {
  describe("given the browser refuses the copy and only the unavailable feedback host is mounted", () => {
    /** @scenario A copy helper keeps its promise when feedback is unavailable */
    it("answers false and does not throw", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      stubClipboard(() => Promise.reject(new Error("denied")));
      setUiFeedbackHost(UNAVAILABLE_UI_FEEDBACK);

      await expect(copyToClipboard({ text: "x", successMessage: "ok" })).resolves.toBe(false);
    });
  });

  describe("given the copy works and no feedback host is mounted", () => {
    /** @scenario A copy helper keeps its promise when feedback is unavailable */
    it("answers true and does not throw", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      stubClipboard(() => Promise.resolve());

      await expect(copyToClipboard({ text: "x", successMessage: "ok" })).resolves.toBe(true);
    });
  });
});
