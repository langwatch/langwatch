import { describe, expect, it } from "vitest";
import { translateFilterToClickHouse } from "../ast";

const TENANT = "project_test";
const TIME_RANGE = { from: 1714435200000, to: 1715040000000 };

function translate(query: string) {
  return translateFilterToClickHouse(query, TENANT, TIME_RANGE);
}

describe("dynamic attribute prefix translation", () => {
  describe("trace.attribute.<key>", () => {
    it("emits a direct equality on trace_summaries.Attributes[key]", () => {
      const result = translate("trace.attribute.langwatch.user.id:user-1");
      expect(result).not.toBeNull();
      expect(result!.sql).toContain("Attributes[{");
      expect(result!.sql).toContain("}] = {");
      // No subquery — trace.attribute. is direct on the summary table.
      expect(result!.sql).not.toContain("stored_spans");
      // Param values round-trip the key + value.
      const params = Object.values(result!.params);
      expect(params).toContain("langwatch.user.id");
      expect(params).toContain("user-1");
    });

    it("aliases the legacy `attribute.<key>` form to the same SQL", () => {
      const a = translate("trace.attribute.langwatch.user.id:user-1");
      const b = translate("attribute.langwatch.user.id:user-1");
      // SQL shape is identical — only the param names differ by counter,
      // which is a function of how the query is parsed not which prefix
      // was used. Compare by stripping param identifiers.
      const stripped = (s: string) =>
        s.replace(/\{[a-zA-Z]+_\d+:[A-Za-z0-9()]+\}/g, "{P}");
      expect(stripped(a!.sql)).toBe(stripped(b!.sql));
    });

    it("rejects an empty key", () => {
      expect(() => translate("trace.attribute.:user-1")).toThrow(
        /key after the dot/i,
      );
    });
  });

  describe("span.attribute.<key>", () => {
    it("answers via a partition-pruned subquery on stored_spans", () => {
      const result = translate(
        "span.attribute.gen_ai.request.model:gpt-4o",
      );
      expect(result).not.toBeNull();
      expect(result!.sql).toContain("FROM stored_spans");
      expect(result!.sql).toContain("SpanAttributes[{");
      // Time predicate gets folded into the subquery's WHERE so the
      // partition-prune kicks in. Cheap proof: param names exist.
      expect(Object.keys(result!.params)).toEqual(
        expect.arrayContaining(["timeFrom", "timeTo", "tenantId"]),
      );
    });

    it("rejects an empty key", () => {
      expect(() => translate("span.attribute.:foo")).toThrow(
        /key after the dot/i,
      );
    });
  });

  describe("event.attribute.<key>", () => {
    it("answers via arrayExists on Events.Attributes", () => {
      const result = translate("event.attribute.exception.type:ValueError");
      expect(result).not.toBeNull();
      expect(result!.sql).toContain("arrayExists");
      expect(result!.sql).toContain("`Events.Attributes`");
    });

    it("aliases the legacy single-dot `event.<key>` form", () => {
      const a = translate("event.attribute.exception.type:ValueError");
      const b = translate("event.exception.type:ValueError");
      const stripped = (s: string) =>
        s.replace(/\{[a-zA-Z]+_\d+:[A-Za-z0-9()]+\}/g, "{P}");
      expect(stripped(a!.sql)).toBe(stripped(b!.sql));
    });

    it("does NOT route the bare `event:<name>` field through this path", () => {
      // `event:gen_ai.user.message` is the static handler (Events.Name).
      // It must not be misrouted to the dynamic prefix translator just
      // because the value contains a dot.
      const result = translate("event:gen_ai.user.message");
      expect(result).not.toBeNull();
      expect(result!.sql).toContain("`Events.Name`");
      expect(result!.sql).not.toContain("Events.Attributes");
    });

    it("rejects an empty key on the namespaced form", () => {
      expect(() => translate("event.attribute.:foo")).toThrow(
        /key after the dot/i,
      );
    });
  });

  describe("key validation", () => {
    it("rejects keys with disallowed characters", () => {
      expect(() => translate('span.attribute.foo bar:value')).toThrow();
      expect(() => translate('trace.attribute.foo"bar:value')).toThrow();
      expect(() => translate("event.attribute.foo[bar]:value")).toThrow();
    });

    it("rejects keys longer than the allowed cap", () => {
      const longKey = "a.".repeat(200);
      expect(() => translate(`trace.attribute.${longKey}:v`)).toThrow(/too long/i);
    });

    it("accepts the dotted / hyphenated / colon-bearing keys we see in real data", () => {
      expect(translate("trace.attribute.langwatch.user.id:u-1")).not.toBeNull();
      expect(translate("span.attribute.gen_ai.request.model:m")).not.toBeNull();
      expect(translate("event.attribute.exception.type:Err")).not.toBeNull();
    });
  });

  describe("combined", () => {
    it("composes namespaced prefixes through AND/OR", () => {
      const result = translate(
        "trace.attribute.langwatch.user.id:u-1 AND span.attribute.gen_ai.request.model:gpt-4o",
      );
      expect(result).not.toBeNull();
      expect(result!.sql).toContain(" AND ");
      expect(result!.sql).toContain("Attributes[{");
      expect(result!.sql).toContain("SpanAttributes[{");
    });

    it("negates a span-attribute filter via NOT", () => {
      const result = translate(
        "NOT span.attribute.gen_ai.request.model:gpt-3.5-turbo",
      );
      expect(result).not.toBeNull();
      expect(result!.sql).toContain("NOT");
    });
  });
});
