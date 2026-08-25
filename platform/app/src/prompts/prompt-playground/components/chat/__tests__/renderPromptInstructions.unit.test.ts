import { describe, expect, it } from "vitest";
import { renderPromptInstructions } from "../renderPromptInstructions";

describe("renderPromptInstructions", () => {
  it("renders the instruction template with the current variable values", () => {
    expect(
      renderPromptInstructions({
        template: "Reply in {{ tone }}.",
        variables: [{ identifier: "tone", value: "plain English" }],
      }),
    ).toBe("Reply in plain English.");
  });

  it("uses the latest conversation input when the input variable is empty", () => {
    expect(
      renderPromptInstructions({
        template: "Answer: {{ input }}",
        variables: [{ identifier: "input", value: "" }],
        latestInput: "Where is Leiden?",
      }),
    ).toBe("Answer: Where is Leiden?");
  });

  it("keeps an explicit input variable value", () => {
    expect(
      renderPromptInstructions({
        template: "Answer: {{ input }}",
        variables: [{ identifier: "input", value: "Saved input" }],
        latestInput: "Conversation input",
      }),
    ).toBe("Answer: Saved input");
  });

  it("returns the template unchanged while a Liquid tag is half typed", () => {
    const template = "Answer: {% if tone ";

    expect(
      renderPromptInstructions({
        template,
        variables: [{ identifier: "tone", value: "plain" }],
      }),
    ).toBe(template);
  });

  it("keeps an input variable that is explicitly false", () => {
    expect(
      renderPromptInstructions({
        template: "Answer: {{ input }}",
        variables: [{ identifier: "input", value: false }],
        latestInput: "Conversation input",
      }),
    ).toBe("Answer: false");
  });
});
