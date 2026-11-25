// The question-opener check of dev/scripts/prose-lint
// (specs/tooling/prose-lint-question-opener.feature).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasContent, openingQuestion, splitSections } from "../prose-lint/lint.mjs";

function opener(body) {
  const sections = splitSections(body, 2);
  return openingQuestion(sections, Math.max(0, sections.findIndex(hasContent)));
}

void describe("question-opener", () => {
  /** @scenario "A question with its answer in the same line is flagged as answered" */
  void it("marks the approved ad as answered in its line", () => {
    const found = opener("# Laptop shut? It still works\n\nThe agent keeps running.\n");
    assert.deepEqual(found, { question: "Laptop shut?", answeredInLine: true });
  });

  /** @scenario "A question with no answer in its line is flagged as a windup" */
  void it("marks a question whose answer is in the next paragraph as unanswered", () => {
    const body =
      "Ever wondered why your bot answers when retrieval is empty?\n\nA try/except returned [].\n";
    const found = opener(body);
    assert.equal(found.question, "Ever wondered why your bot answers when retrieval is empty?");
    assert.equal(found.answeredInLine, false);
  });

  /** @scenario "A statement H1 does not hide a question in the first paragraph" */
  void it("reads the first paragraph when the H1 is a statement", () => {
    const found = opener("# Support bots\n\nWhy did retrieval return nothing? A timeout.\n");
    assert.deepEqual(found, {
      question: "Why did retrieval return nothing?",
      answeredInLine: true,
    });
  });

  /** @scenario "A question that wraps onto a second line is judged by the line holding its mark" */
  void it("checks the text after the mark on the mark's own line", () => {
    const found = opener(
      "Why does the support bot answer\nwhen retrieval is empty?\nIt guesses.\n",
    );
    assert.equal(found.answeredInLine, false);
  });

  /** @scenario "An image wrapper before the first text paragraph is skipped" */
  void it("skips a block that carries no sentences", () => {
    const body = '<Frame>\n  <img src="/images/a.png" />\n</Frame>\n\nWhat is Langy? An agent.\n';
    assert.equal(opener(body)?.question, "What is Langy?");
  });

  /** @scenario "A statement opener and a question later on are not flagged" */
  void it("reports nothing when the opener is a statement", () => {
    const body =
      "The agent forgets because it compacts its context. So why keep it all? The bill.\n";
    assert.equal(opener(body), null);
  });
});
