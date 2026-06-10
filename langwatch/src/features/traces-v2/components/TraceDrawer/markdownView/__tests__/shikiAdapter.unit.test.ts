/**
 * Unit tests for shikiAdapter — split helpers.
 *
 * Verifies:
 *  - getSharedHighlighter() resolves to a usable Highlighter instance
 *  - ensureDisposeNeutered() monkey-patches dispose() to a no-op
 *  - calling h.dispose() after patching leaves the highlighter usable
 *  - ensureDisposeNeutered() is idempotent — calling it twice is safe
 */

import { describe, expect, it } from "vitest";
import {
  ensureDisposeNeutered,
  getSharedHighlighter,
} from "../shikiAdapter";

describe("given the shikiAdapter split helpers", () => {
  describe("when getSharedHighlighter() resolves", () => {
    it("returns a highlighter that can tokenise code", async () => {
      const h = await getSharedHighlighter();
      expect(h).toBeDefined();
      // Basic smoke-test: codeToHtml must produce an HTML string
      const html = h.codeToHtml("const x = 1;", {
        lang: "typescript",
        theme: "github-light",
      });
      expect(typeof html).toBe("string");
      expect(html).toContain("<pre");
    });
  });

  describe("when ensureDisposeNeutered is applied and h.dispose() is called", () => {
    it("the highlighter remains usable after dispose() — dispose was a no-op", async () => {
      const h = await getSharedHighlighter();
      ensureDisposeNeutered(h);

      // Call dispose — must be a no-op (cast needed: dispose() exists at runtime)
      (h as unknown as { dispose: () => void }).dispose();

      // Highlighter must still work
      const html = h.codeToHtml("echo hello", {
        lang: "bash",
        theme: "github-light",
      });
      expect(typeof html).toBe("string");
      expect(html).toContain("<pre");
    });

    it("sets the __lwDisposeNeutered marker on the instance", async () => {
      const h = await getSharedHighlighter();
      ensureDisposeNeutered(h);
      expect(
        (h as unknown as { __lwDisposeNeutered?: boolean }).__lwDisposeNeutered,
      ).toBe(true);
    });
  });

  describe("when ensureDisposeNeutered is called twice (idempotency)", () => {
    it("does not throw and the highlighter is still usable", async () => {
      const h = await getSharedHighlighter();

      // First call
      ensureDisposeNeutered(h);
      // Second call — must not throw
      expect(() => ensureDisposeNeutered(h)).not.toThrow();

      // Still usable
      const html = h.codeToHtml("x = 1", {
        lang: "python",
        theme: "github-light",
      });
      expect(typeof html).toBe("string");
      expect(html).toContain("<pre");
    });

    it("the __lwDisposeNeutered marker is still set to true after two calls", async () => {
      const h = await getSharedHighlighter();
      ensureDisposeNeutered(h);
      ensureDisposeNeutered(h);
      expect(
        (h as unknown as { __lwDisposeNeutered?: boolean }).__lwDisposeNeutered,
      ).toBe(true);
    });
  });
});
