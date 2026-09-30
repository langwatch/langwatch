/**
 * A line Langy wrote is shown once: the reply text drops a line already said
 * with `say`, and a `say` that only voices a question card's own question is
 * dropped.
 */
import { describe, expect, it } from "vitest";
import { partsShownOnce, textWithoutSaidLines } from "../shownOnce";

const PULL_REQUEST =
  "I opened a pull request with the tracing change: https://example.test/acme/pull/3. You can merge it already.";
const BRANCH =
  "I left branch langy/acme-checkout checked out: the agent you started runs on it.";
const PROPOSAL =
  "Now that your agent is integrated, I think we should write some tests for it. The first one I'd write is Guest completes checkout.";

function say(text: string, id = "say_1") {
  return {
    type: "tool-say",
    toolCallId: id,
    state: "output-available",
    input: { text },
    output: "Said.",
  };
}

function question(text: string) {
  return {
    type: "tool-question",
    toolCallId: "question_1",
    state: "output-available",
    input: {
      questions: [
        {
          question: text,
          bare: true,
          options: [{ label: "Create it" }, { label: "Chat about this" }],
        },
      ],
    },
    output: "answered",
  };
}

function text(value: string) {
  return { type: "text", text: value, role: "assistant" };
}

describe("given a turn that said its lines and then wrote them again", () => {
  it("keeps the said lines and empties the reply that repeated them", () => {
    const parts = partsShownOnce([
      say(PULL_REQUEST, "say_1"),
      say(BRANCH, "say_2"),
      text(`${PULL_REQUEST}\n${BRANCH}`),
    ]);

    expect(parts.map((part) => part.type)).toEqual([
      "tool-say",
      "tool-say",
      "text",
    ]);
    expect(parts.at(-1)).toMatchObject({ text: "" });
  });

  it("keeps the part of the reply that was not said", () => {
    const parts = partsShownOnce([
      say(PULL_REQUEST),
      text(`${PULL_REQUEST}\nOne more thing: the suite runs nightly.`),
    ]);

    expect(parts.at(-1)).toMatchObject({
      text: "One more thing: the suite runs nightly.",
    });
  });

  it("reads a line that differs only in spacing as the same line", () => {
    expect(
      textWithoutSaidLines("  I said   this.  ", new Set(["I said this."])),
    ).toBe("");
  });

  it("keeps a line that differs by a word", () => {
    const kept = textWithoutSaidLines(
      "I opened a pull request with the tracing change and the tests.",
      new Set([PULL_REQUEST.replace(/\s+/g, " ")]),
    );

    expect(kept).toBe(
      "I opened a pull request with the tracing change and the tests.",
    );
  });
});

describe("given a proposal that was both said and asked on a card", () => {
  it("drops the said copy and leaves the card to ask it", () => {
    const parts = partsShownOnce([say(PROPOSAL), question(PROPOSAL), text("")]);

    expect(parts.map((part) => part.type)).toEqual(["tool-question", "text"]);
  });

  it("leaves a said line that no card asks", () => {
    const parts = partsShownOnce([say(BRANCH), question(PROPOSAL), text("")]);

    expect(parts.map((part) => part.type)).toEqual([
      "tool-say",
      "tool-question",
      "text",
    ]);
  });
});

describe("given a turn with nothing to deduplicate", () => {
  it("hands back the same parts", () => {
    const parts = [say(BRANCH), text("A reply of its own.")];

    expect(partsShownOnce(parts)).toEqual(parts);
  });
});
