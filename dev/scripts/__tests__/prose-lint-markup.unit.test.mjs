// Markup stripping of dev/scripts/prose-lint (specs/tooling/prose-lint-markup.feature).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripMarkup } from "../prose-lint/lint.mjs";

void describe("stripMarkup", () => {
  /** @scenario "A link keeps its text and drops its URL" */
  void it("keeps link text and drops the URL", () => {
    const text = "It follows the [recipe](https://github.com/langwatch/skills/tree/main).";
    assert.equal(stripMarkup(text), "It follows the recipe.");
  });

  /** @scenario "An image goes entirely" */
  void it("drops an image with its alt text", () => {
    assert.equal(stripMarkup("See ![a chart](https://example.com/a.png) here."), "See  here.");
    assert.equal(
      stripMarkup("A \\![langwatch](https://example.com) mark."),
      "A \\!langwatch mark.",
    );
    assert.equal(
      stripMarkup("Not \\[a link](https://example.com)."),
      "Not \\[a link](https://example.com).",
    );
  });

  /** @scenario "A link with brackets or parentheses keeps only its text" */
  void it("handles brackets in the label and parentheses in the URL", () => {
    assert.equal(
      stripMarkup("Use [`items[0]`](https://github.com/langwatch/x)."),
      "Use `items[0]`.",
    );
    assert.equal(stripMarkup("[Guide](https://example.com/a(b)/langwatch) now"), "Guide now");
    assert.equal(stripMarkup("[a [b](u) c](v) and [x"), "a b c and [x");
    assert.equal(stripMarkup("[![logo](a.png)](https://x) done"), " done");
  });

  /** @scenario "Pathological markup strips in linear time" */
  void it("strips pathological markup quickly and without recursion", () => {
    const n = 50_000;
    const cases = [
      ["[".repeat(n), "[".repeat(n)],
      ["[a](".repeat(n), "[a](".repeat(n)],
      [`${"[".repeat(20_000)}a${"](u)".repeat(20_000)}`, "a"],
      ["![".repeat(n), "![".repeat(n)],
    ];
    for (const [input, expected] of cases) {
      const started = performance.now();
      assert.equal(stripMarkup(input), expected);
      assert.ok(performance.now() - started < 1_000, `took ${performance.now() - started} ms`);
    }
  });
});
