/**
 * A clipboard write must not claim success for a write the browser refused.
 * A reader told "copied" for a credential that never reached the clipboard
 * finds out when their SDK rejects it.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import { describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "../src/features/api-key/behavior/api-key-clipboard";

describe("given a screen copies a credential", () => {
  describe("when the write lands", () => {
    it("says what was copied, in the screen's own words", async () => {
      const onSucceeded = vi.fn();
      const onFailed = vi.fn();
      const ok = await copyToClipboard({
        text: "sk-lw-secret",
        succeeded: { title: "API key copied to clipboard" },
        writeClipboard: () => Promise.resolve(),
        onSucceeded,
        onFailed,
      });
      expect(ok).toBe(true);
      expect(onSucceeded).toHaveBeenCalledWith({ title: "API key copied to clipboard" });
      expect(onFailed).not.toHaveBeenCalled();
    });
  });

  describe("when the browser refuses the write", () => {
    it("answers false and says so, rather than claiming a copy that did not happen", async () => {
      const refusal = new Error("Document is not focused");
      const onSucceeded = vi.fn();
      const onFailed = vi.fn();
      const ok = await copyToClipboard({
        text: "sk-lw-secret",
        succeeded: { title: "API key copied to clipboard" },
        writeClipboard: () => Promise.reject(refusal),
        onSucceeded,
        onFailed,
      });
      expect(ok).toBe(false);
      expect(onSucceeded).not.toHaveBeenCalled();
      expect(onFailed).toHaveBeenCalledWith({
        error: refusal,
        fallbackTitle: "Failed to copy",
        description: "Couldn't copy. Please try again.",
      });
    });
  });
});
