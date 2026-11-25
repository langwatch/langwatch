/** @see specs/features/onboarding/guided-welcome-takeover.feature */
import { describe, expect, it } from "vitest";

import { helloSegments, valueSegments } from "../copy.ts";

const typed = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

describe("helloSegments()", () => {
  it("greets a named user by name", () => {
    expect(typed(helloSegments({ name: "Ada" }))).toMatch(/^Hello Ada, I'm Langy 👋/);
  });

  it("drops the name, with no placeholder word, when there is none", () => {
    const line = typed(helloSegments({ name: undefined }));
    expect(line).toMatch(/^Hello, I'm Langy 👋/);
    expect(line).not.toContain("there");
  });
});

describe("valueSegments()", () => {
  it("names a named user in the question", () => {
    expect(typed(valueSegments({ name: "Ada", target: "ACME" }))).toMatch(/^So tell me, Ada, what/);
  });

  it("asks without a name when there is none", () => {
    expect(typed(valueSegments({ name: undefined, target: "ACME" }))).toBe(
      "So tell me, what are the most valuable things we can set up for ACME today?",
    );
  });
});
