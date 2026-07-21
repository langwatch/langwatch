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
});
