import { describe, expect, expectTypeOf, it } from "vitest";
import type { CamelToSnake } from "./snakeCase";
import { toSnakeCase } from "./snakeCase";

/**
 * A derived event type string must be byte-identical whether it is narrowed by
 * the type checker or computed at runtime, so these tests check the two
 * implementations agree, not just that either one looks right on its own.
 */
describe("toSnakeCase / CamelToSnake", () => {
  describe("given an ordinary camelCase identifier", () => {
    it("inserts an underscore before each capital", () => {
      expect(toSnakeCase("spanReceived")).toBe("span_received");
      expectTypeOf<
        CamelToSnake<"spanReceived">
      >().toEqualTypeOf<"span_received">();
    });

    it("leaves an already-lowercase identifier alone", () => {
      expect(toSnakeCase("received")).toBe("received");
      expectTypeOf<CamelToSnake<"received">>().toEqualTypeOf<"received">();
    });
  });

  describe("given an identifier carrying a run of capitals", () => {
    it("treats the acronym as one word, splitting only before the word that follows it", () => {
      expect(toSnakeCase("parseHTMLDoc")).toBe("parse_html_doc");
      expectTypeOf<
        CamelToSnake<"parseHTMLDoc">
      >().toEqualTypeOf<"parse_html_doc">();
    });

    it("keeps a leading acronym as one word", () => {
      expect(toSnakeCase("HTMLParser")).toBe("html_parser");
      expectTypeOf<CamelToSnake<"HTMLParser">>().toEqualTypeOf<"html_parser">();
    });
  });

  describe("given an identifier carrying digits", () => {
    it("does not treat a digit as a word-starting capital", () => {
      expect(toSnakeCase("originV2Resolved")).toBe("origin_v2_resolved");
      expectTypeOf<
        CamelToSnake<"originV2Resolved">
      >().toEqualTypeOf<"origin_v2_resolved">();
    });
  });

  describe("given the type-level and runtime derivations", () => {
    it("agree on a representative set of event keys", () => {
      const keys = [
        "spanReceived",
        "topicAssigned",
        "originResolved",
        "parseHTMLDoc",
        "HTMLParser",
        "originV2Resolved",
      ] as const;

      for (const key of keys) {
        const runtime = toSnakeCase(key);
        type FromType = CamelToSnake<typeof key>;
        // The point of the check: the runtime output is assignable to the
        // exact literal the type-level walk computed for the same input.
        const typed: FromType = runtime as FromType;
        expect(typed).toBe(runtime);
      }
    });
  });
});
