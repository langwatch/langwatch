/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyShareLink } from "../copy-share-link";

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("copying a share link", () => {
  describe("when the clipboard is available", () => {
    it("writes the url and reports success", async () => {
      const writeText = vi.fn(async () => void 0);
      stubClipboard(writeText);

      await expect(copyShareLink("https://app.test/share/tok")).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith("https://app.test/share/tok");
    });
  });

  describe("when the page has no clipboard (a plain-http self-hosted domain)", () => {
    it("reports failure instead of throwing", async () => {
      await expect(copyShareLink("https://app.test/share/tok")).resolves.toBe(false);
    });
  });

  describe("when the clipboard write is refused", () => {
    it("reports failure instead of propagating", async () => {
      stubClipboard(async () => {
        throw new Error("denied");
      });

      await expect(copyShareLink("https://app.test/share/tok")).resolves.toBe(false);
    });
  });
});
