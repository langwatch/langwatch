import { describe, expect, it } from "vitest";
import {
  defaultValueLiteralFor,
  findLastReturnDict,
  literalKindFor,
  literalKindOf,
  parseSimpleDictEntries,
  scanImports,
} from "../src/code/python-provider.shared";

describe("Workflow Python provider helpers", () => {
  it("classifies declared fields and literal values", () => {
    expect(literalKindFor("json_schema")).toBe("dict");
    expect(literalKindOf("['one']")).toBe("list");
    expect(defaultValueLiteralFor("bool")).toBe("False");
  });

  it("uses the last return dictionary for output validation", () => {
    const source = "return {'old': 1}\nreturn {'answer': 'new'}";

    expect(findLastReturnDict(source)).toEqual({
      body: "'answer': 'new'",
      bodyStart: 26,
    });
  });

  it("parses top-level dictionary entries without splitting nested values", () => {
    expect(parseSimpleDictEntries("'answer': {'nested': 1}, 'count': 2")).toEqual([
      { key: "answer", value: "{'nested': 1}", valueOffset: 10 },
      { key: "count", value: "2", valueOffset: 34 },
    ]);
  });

  it("recognises supported Python imports for member completion", () => {
    expect([...scanImports("import math")].map(([name]) => name)).toEqual(["math"]);
  });
});
