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
  });
});
