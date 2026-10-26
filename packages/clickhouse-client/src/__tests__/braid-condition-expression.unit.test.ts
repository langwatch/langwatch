/** The braid preview's predicate rendering (ADR-185 §3, §7): every key and literal a parameter. */
import type { CompiledWhere } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { braidConditionExpression } from "../authorized-reads.ts";
import { StatementScopeError } from "../statementScopeError.ts";

const compiledWhere: CompiledWhere = {
  version: 1,
  tree: {
    kind: "and",
    terms: [
      { kind: "attributeEquals", on: "span", key: "orchestrator'", value: "web'); DROP" },
      { kind: "verified", key: "orchestrator" },
    ],
  },
};

describe("braidConditionExpression", () => {
  describe("given a condition holding literals and a Verified() term", () => {
    it("binds every key and literal under the prefix, and the reader for Verified()", () => {
      const rendered = braidConditionExpression({
        compiledWhere,
        reader: "proj_reader",
        prefix: "preview",
      });

      expect(rendered.sql).toBe(
        "(SpanAttributes[{preview_0k:String}] = {preview_0v:String} AND SpanAttributes[{preview_1k:String}] = {preview_reader:String})",
      );
      expect(rendered.params).toEqual({
        preview_0k: "orchestrator'",
        preview_0v: "web'); DROP",
        preview_1k: "langwatch.reserved.verified.orchestrator",
        preview_reader: "proj_reader",
      });
      expect(rendered.sql).not.toContain("orchestrator");
      expect(rendered.sql).not.toContain("proj_reader");
    });
  });

  describe("given the fence's own parameter prefix", () => {
    it("refuses it, so a statement cannot write into the fence's parameters", () => {
      expect(() =>
        braidConditionExpression({ compiledWhere, reader: "r", prefix: "tenantScope" }),
      ).toThrow(StatementScopeError);
    });
  });
});
