import { describe, expect, it } from "vitest";
import {
  type QrRenderContext,
  renderClaimBlock,
  renderQr,
  shouldRenderQr,
} from "../terminal-qr";

const interactive: QrRenderContext = {
  isInteractive: true,
  columns: 120,
  isAgent: false,
};

const URL = "https://app.langwatch.ai/claim/abc123";

describe("deciding whether to draw a QR", () => {
  describe("given a wide interactive terminal", () => {
    it("draws it", () => {
      expect(shouldRenderQr(interactive)).toBe(true);
    });
  });

  describe("given an agent is driving", () => {
    /** @scenario "an agent-driven run prints no QR and opens no browser" */
    it("does not — an agent cannot scan anything", () => {
      expect(shouldRenderQr({ ...interactive, isAgent: true })).toBe(false);
    });
  });

  describe("given output is not a terminal", () => {
    it("does not — a pipe or a CI log gets noise, not a code", () => {
      expect(shouldRenderQr({ ...interactive, isInteractive: false })).toBe(
        false,
      );
    });
  });

  describe("given the terminal is too narrow", () => {
    it("does not — a mangled QR looks scannable and is not", () => {
      expect(shouldRenderQr({ ...interactive, columns: 40 })).toBe(false);
    });
  });

  describe("given the width is unknown", () => {
    it("draws it rather than suppressing on a missing signal", () => {
      expect(shouldRenderQr({ isInteractive: true, isAgent: false })).toBe(
        true,
      );
    });
  });
});

describe("rendering the code", () => {
  describe("given a URL", () => {
    it("produces terminal-drawable output", async () => {
      const qr = await renderQr(URL);

      expect(qr).not.toBeNull();
      expect(qr!.length).toBeGreaterThan(0);
      // Block glyphs are what a terminal QR is made of; if we ever get an
      // image buffer back instead, this catches it.
      expect(qr!).toMatch(/[▀-▟]/);
    });
  });

  describe("given an input the encoder cannot handle", () => {
    it("returns null instead of throwing", async () => {
      // Provisioning has already created a real account by this point; a QR
      // failure must not take the run down when the URL beside it works.
      const huge = `https://example.com/${"x".repeat(10_000)}`;
      await expect(renderQr(huge)).resolves.toBeNull();
    });
  });
});

describe("the claim block the developer sees", () => {
  describe("in an interactive terminal", () => {
    /** @scenario "the claim URL is printed as a QR code for a phone to scan" */
    it("shows the code and the URL", async () => {
      const lines = await renderClaimBlock({ url: URL, context: interactive });

      expect(lines.join("\n")).toContain(URL);
      expect(lines.length).toBeGreaterThan(1);
    });
  });

  describe("when a QR would not help", () => {
    /** @scenario "the QR is skipped where it cannot work" */
    it.each([
      { label: "an agent", ctx: { ...interactive, isAgent: true } },
      {
        label: "a pipe",
        ctx: { ...interactive, isInteractive: false },
      },
      { label: "a narrow terminal", ctx: { ...interactive, columns: 20 } },
    ])("still prints the URL for $label", async ({ ctx }) => {
      const lines = await renderClaimBlock({ url: URL, context: ctx });

      expect(lines).toEqual([URL]);
    });
  });
});
