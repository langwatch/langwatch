import { describe, expect, it } from "vitest";
import { composeSystemPrompt, prependResumeSeed } from "./system-prompt.js";

describe("composeSystemPrompt", () => {
  describe("when persona, AGENTS.md and a turn system block", () => {
    // AGENTS.md last is deliberate: its ending Replies rules take the
    // recency-max position, the layout the reply-style suite is green against.
    it("joins them persona first, turn system middle, AGENTS.md last", () => {
      expect(
        composeSystemPrompt({
          personaPrompt: "You are Langy.",
          agentsMd: "# Rules",
          turnSystem: "Turn context.",
        }),
      ).toBe("You are Langy.\n\nTurn context.\n\n# Rules");
    });
  });

  describe("when no turn system block", () => {
    it("composes persona + AGENTS.md only", () => {
      expect(composeSystemPrompt({ personaPrompt: "P", agentsMd: "A" })).toBe("P\n\nA");
    });
  });

  describe("when empty or whitespace sections", () => {
    it("drops them instead of emitting empty separators", () => {
      expect(composeSystemPrompt({ personaPrompt: "  ", agentsMd: "A", turnSystem: "" })).toBe("A");
    });
  });
});

describe("prependResumeSeed", () => {
  it("labels the seed clearly and keeps the prompt last", () => {
    const combined = prependResumeSeed({ prompt: "do the thing", seed: "user: earlier context" });
    expect(combined.indexOf("user: earlier context")).toBeGreaterThan(-1);
    expect(combined.indexOf("user: earlier context")).toBeLessThan(combined.indexOf("do the thing"));
    expect(combined.startsWith("[Resumed conversation")).toBe(true);
    expect(combined.endsWith("do the thing")).toBe(true);
  });
});
