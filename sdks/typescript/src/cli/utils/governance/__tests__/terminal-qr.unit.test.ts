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

  describe("given a URL", () => {
    it("draws every module the encoder produced, the right way up", async () => {
      // The half-block packing is the part that can silently go wrong: an
      // off-by-one in the row pairing, or an inverted mapping, still renders
      // something QR-shaped that no camera will read. Unpacking the drawing
      // back into modules and comparing against the encoder's own matrix is
      // what catches that — a visual check never would.
      const { create } = await import("qrcode");
      const { modules } = create(URL, { errorCorrectionLevel: "L" });

      const rendered = await renderQr(URL);
      // eslint-disable-next-line no-control-regex
      const grid = rendered!.replace(/\[[0-9;]*m/g, "").split("\n");

      const quiet = 4;
      const width = modules.size + quiet * 2;
      expect(grid[0]).toHaveLength(width);
      expect(grid).toHaveLength(Math.ceil(width / 2));

      const darkAt = (row: number, col: number): boolean => {
        const glyph = grid[Math.floor((row + quiet) / 2)]![col + quiet]!;
        const upperHalf = (row + quiet) % 2 === 0;
        return glyph === "█" || glyph === (upperHalf ? "▀" : "▄");
      };

      for (let row = 0; row < modules.size; row++) {
        for (let col = 0; col < modules.size; col++) {
          const expected = modules.data[row * modules.size + col] === 1;
          if (darkAt(row, col) !== expected) {
            throw new Error(
              `module (${row},${col}) drawn ${darkAt(row, col) ? "dark" : "light"}, encoder says ${expected ? "dark" : "light"}`,
            );
          }
        }
      }
    });

    it("surrounds the symbol with the quiet zone a scanner needs to find it", async () => {
      const rendered = await renderQr(URL);
      // eslint-disable-next-line no-control-regex
      const grid = rendered!.replace(/\[[0-9;]*m/g, "").split("\n");

      // Two character rows top and bottom is four module rows; a scanner that
      // cannot find the border does not attempt the symbol at all.
      expect(grid[0]!.trim()).toBe("");
      expect(grid[1]!.trim()).toBe("");
      expect(grid[grid.length - 1]!.trim()).toBe("");
      for (const line of grid) {
        expect(line.slice(0, 4)).toBe("    ");
        expect(line.slice(-4)).toBe("    ");
      }
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
