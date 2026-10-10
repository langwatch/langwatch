import { describe, expect, it } from "vitest";

import { httpBodyLanguage, prettyBody } from "../http-body-language.ts";

describe("httpBodyLanguage", () => {
  it.each([
    ["application/json; charset=utf-8", "json"],
    ["application/vnd.api+json", "json"],
    ["text/xml", "xml"],
    ["application/x-www-form-urlencoded", "urlencoded"],
    ["text/plain", "plaintext"],
  ])("maps %s to %s", (value, expected) => {
    expect(httpBodyLanguage({ headers: [{ key: "content-TYPE", value }] })).toBe(expected);
  });

  it("assumes JSON when there is no Content-Type header", () => {
    expect(httpBodyLanguage({ headers: [] })).toBe("json");
  });
});

describe("prettyBody", () => {
  it("pretty-prints JSON and leaves other bodies as written", () => {
    expect(prettyBody({ body: '{"a":1}' })).toEqual({ code: '{\n  "a": 1\n}', language: "json" });
    expect(prettyBody({ body: "a=1&b=2" })).toEqual({ code: "a=1&b=2", language: "text" });
  });
});
