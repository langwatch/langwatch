import { describe, expect, it } from "vitest";

import { unparseable } from "../code-syntax.ts";

const sample = ({ lang, text }: { lang: string; text: string }) =>
  unparseable({ lang, lines: text.split("\n") });

describe("when a code block is checked for syntax", () => {
  /** @scenario "A code sample parses in its own language" */
  it("reports JSON that does not parse", () => {
    expect(sample({ lang: "json", text: '{"a": 1,}' })).toBe(true);
    expect(sample({ lang: "json", text: '{"a": 1}' })).toBe(false);
  });

  /** @scenario "A code sample parses in its own language" */
  it("reports YAML that does not parse", () => {
    expect(sample({ lang: "yaml", text: "a: 1\na: 2" })).toBe(true);
    expect(sample({ lang: "yaml", text: "a:\n  b: 1\nc: ${{ secrets.KEY }}" })).toBe(false);
  });

  /** @scenario "A code sample parses in its own language" */
  it("reports a Python block opener followed by an unindented line", () => {
    expect(sample({ lang: "python", text: "for row in rows:\nprint(row)" })).toBe(true);
    expect(
      sample({ lang: "python", text: "for row in rows:\n    # each row\n    print(row)" }),
    ).toBe(false);
    expect(sample({ lang: "python", text: 'data = {"a": 1}\nif ok: print(data)' })).toBe(false);
  });

  /** @scenario "A code sample parses in its own language" */
  it("leaves templates, comments and ellipses unparsed", () => {
    expect(sample({ lang: "json", text: '{"messages": {{ messages }}}' })).toBe(false);
    expect(sample({ lang: "json", text: '{\n  // the key\n  "a": 1,\n}' })).toBe(false);
    expect(sample({ lang: "json", text: '{"a": [1, ...]}' })).toBe(false);
  });
});
