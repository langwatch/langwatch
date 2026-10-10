import { describe, expect, it } from "vitest";

import { checkJsonPath, locateJsonPathNode, parseJsonPath } from "../json-path-segments.ts";
import { knownResponseShape } from "../known-response-shapes.ts";

const check = (path: string, shape: unknown, anyIndex = false) =>
  checkJsonPath({ segments: parseJsonPath({ path }), shape, anyIndex });

describe("checkJsonPath", () => {
  it("passes a path the OpenAI sample contains", () => {
    const shape = knownResponseShape({ url: "https://api.openai.com/v1/chat/completions" });
    expect(check("$.choices[1].message.content", shape, true).every((s) => s === "ok")).toBe(true);
  });

  it("marks the first missing segment and leaves the rest unchecked", () => {
    const statuses = check("$.data.text.more", { data: {} });
    expect(statuses).toEqual(["ok", "ok", "ok", "ok", "missing", "unchecked", "unchecked"]);
  });

  it("checks an index against the real array length", () => {
    expect(check("$.a[2]", { a: [1] }).at(-1)).toBe("missing");
  });
});

describe("locateJsonPathNode", () => {
  it("reports the range of the picked node in the pretty text", () => {
    const { text, range } = locateJsonPathNode({
      value: { choices: [{ message: { content: "hi" } }] },
      path: "$.choices[0].message.content",
    });
    expect(range && text.slice(range.start, range.end)).toBe('"hi"');
  });

  it("reports no range when the path does not resolve", () => {
    expect(locateJsonPathNode({ value: { a: 1 }, path: "$.b" }).range).toBeUndefined();
  });
});
