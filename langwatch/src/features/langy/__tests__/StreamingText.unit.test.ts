import { describe, expect, it } from "vitest";
import { partitionStreamingText } from "../components/StreamingText";

describe("partitionStreamingText", () => {
  it("keeps a long answer's animated DOM bounded while preserving every character", () => {
    const text = Array.from(
      { length: 120 },
      (_, index) => `word-${index}`,
    ).join(" ");

    const result = partitionStreamingText(text);

    expect(result.animatedWords).toHaveLength(48);
    expect(result.settledText + result.animatedWords.join("")).toBe(text);
  });

  it("keeps short replies entirely in the reveal tail", () => {
    const result = partitionStreamingText("one two three");

    expect(result.settledText).toBe("");
    expect(result.animatedWords).toEqual(["one ", "two ", "three"]);
  });

  it("keeps newlines out of the word tokens so multi-line prose reads in order", () => {
    // The regression: "traces.\n\n" as ONE inline-block token parked the word
    // a line above its sentence (an inline-block's baseline is its last line
    // box), scrambling every multi-line answer at the streaming edge.
    const text = "Top traces.\n\n- first one\n- second one";

    const result = partitionStreamingText(text);

    for (const word of result.animatedWords) {
      if (word.includes("\n")) {
        // A token carrying a newline is pure whitespace — it renders as plain
        // flow text, never inside an animated inline-block span.
        expect(word.trim()).toBe("");
      }
    }
    // Nothing lost in the re-tokenisation.
    expect(result.settledText + result.animatedWords.join("")).toBe(text);
  });
});
