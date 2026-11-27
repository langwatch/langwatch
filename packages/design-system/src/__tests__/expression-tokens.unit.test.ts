import { describe, expect, it } from "vitest";

import { tokeniseExpression } from "../expression-tokens.ts";

describe("Feature: Filter expressions read with syntax highlighting", () => {
  /** @scenario "An expression splits into tokens that join back to the text" */
  it("Scenario: An expression splits into tokens that join back to the text", () => {
    const text = 'attributes["orchestrator"] == "web" and Verified("orchestrator")';
    const tokens = tokeniseExpression({ text });
    expect(tokens.map((token) => token.text).join("")).toBe(text);
    expect(tokens.filter((token) => token.kind !== "plain").map((t) => [t.kind, t.text])).toEqual([
      ["field", "attributes"],
      ["punctuation", "["],
      ["string", '"orchestrator"'],
      ["punctuation", "]"],
      ["operator", "=="],
      ["string", '"web"'],
      ["keyword", "and"],
      ["function", "Verified"],
      ["punctuation", "("],
      ["string", '"orchestrator"'],
      ["punctuation", ")"],
    ]);
  });

  it("keeps an escaped quote inside its string and reads numbers and nil", () => {
    const tokens = tokeniseExpression({ text: 'name == "a\\"b" or attributes["n"] != nil 12' });
    expect(tokens.find((token) => token.kind === "string")?.text).toBe('"a\\"b"');
    expect(tokens.filter((token) => token.kind === "keyword").map((t) => t.text)).toEqual([
      "or",
      "nil",
    ]);
    expect(tokens.at(-1)).toMatchObject({ kind: "number", text: "12" });
  });

  /** @scenario "An unfinished expression still highlights" */
  it("Scenario: An unfinished expression still highlights", () => {
    const tokens = tokeniseExpression({ text: 'attributes["orch' });
    expect(tokens.at(-1)).toMatchObject({ kind: "string", text: '"orch' });
  });

  it("joins back to the text whatever is typed", () => {
    const text = "  weird ~ text\n€ (x) ";
    expect(
      tokeniseExpression({ text })
        .map((token) => token.text)
        .join(""),
    ).toBe(text);
  });
});
