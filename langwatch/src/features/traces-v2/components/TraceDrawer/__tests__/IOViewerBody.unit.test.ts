import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "../IOViewerBody";

describe("looksLikeMarkdown", () => {
  describe("given a candidate text input", () => {
    describe("when the text carries a structural Markdown construct", () => {
      it("detects an ATX heading", () => {
        expect(looksLikeMarkdown("# Title\n\nbody text")).toBe(true);
      });

      it("detects a bullet list", () => {
        expect(looksLikeMarkdown("intro\n- one\n- two")).toBe(true);
      });

      it("detects an ordered list", () => {
        expect(looksLikeMarkdown("steps:\n1. first\n2. second")).toBe(true);
      });

      it("detects a blockquote", () => {
        expect(looksLikeMarkdown("> quoted line")).toBe(true);
      });

      it("detects a fenced code block", () => {
        expect(looksLikeMarkdown("see:\n```\ncode()\n```")).toBe(true);
      });

      it("detects a link", () => {
        expect(looksLikeMarkdown("read [the docs](https://x.dev) now")).toBe(
          true,
        );
      });

      it("detects a table with a header rule", () => {
        expect(looksLikeMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(
          true,
        );
      });

      it("detects bold emphasis", () => {
        expect(looksLikeMarkdown("this is **important** stuff")).toBe(true);
      });

      it("detects inline code", () => {
        expect(looksLikeMarkdown("call the `render()` method")).toBe(true);
      });
    });

    describe("when the text is plain (not Markdown)", () => {
      it("treats prose as plain", () => {
        expect(
          looksLikeMarkdown("The quick brown fox jumps over the lazy dog."),
        ).toBe(false);
      });

      it("treats a log dump as plain", () => {
        expect(
          looksLikeMarkdown(
            "2026-06-15 12:00:01 INFO started\n2026-06-15 12:00:02 WARN slow",
          ),
        ).toBe(false);
      });

      it("treats a stack trace as plain", () => {
        expect(
          looksLikeMarkdown(
            "Error: boom\n    at foo (a.ts:1:2)\n    at bar (b.ts:3:4)",
          ),
        ).toBe(false);
      });

      it("treats an empty string as plain", () => {
        expect(looksLikeMarkdown("")).toBe(false);
      });

      it("does not fire on a lone asterisk mid-sentence", () => {
        expect(looksLikeMarkdown("multiply a * b for the area")).toBe(false);
      });
    });
  });
});
