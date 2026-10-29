import { validationMeta } from "@langwatch/observability";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { declaredPath } from "../output-issue-path.ts";

/** The shape of a trace's spans: a union of span kinds whose params mix named and open keys. */
const params = z
  .object({ user: z.string().optional(), temperature: z.number().optional() })
  .and(z.record(z.string(), z.any()));
const base = z.object({ span_id: z.string(), type: z.string(), params: params.optional() });
const spans = z.array(
  z.union([
    base.extend({ type: z.literal("llm"), model: z.string().optional() }),
    base.extend({ type: z.literal("rag"), contexts: z.array(z.string()) }),
    base,
  ]),
);

const logged = (value: unknown) => {
  const parsed = spans.safeParse(value);
  return validationMeta(parsed.error, {
    privacy: "schema-only",
    schemaPath: (path) => declaredPath(spans, path),
  });
};

describe("declaredPath", () => {
  describe("when a span's own attributes collide with a named param", () => {
    // Prod 2026-10-29: `user.*` attributes made `params.user` an object, and every path was
    // logged as `<redacted>`, so nothing said which field failed.
    it("names the field, through the union arm, from the root of the answer", () => {
      const meta = logged([
        { span_id: "a", type: "tool" },
        { span_id: "b", type: "tool", params: { user: { agency: { id: "agency-1" } } } },
      ]);

      const paths = meta?.issues.map((issue) => issue.path);
      expect(paths).toContain("[1].params.user");
      expect(JSON.stringify(meta)).not.toContain("agency");
    });
  });

  describe("when a path passes through a key the schema does not declare", () => {
    it("replaces the key and keeps the rest of the path", () => {
      const schema = z.object({ params: z.record(z.string(), z.object({ id: z.string() })) });

      expect(declaredPath(schema, ["params", "customer-key", "id"])).toBe("params.<key>.id");
    });

    it("replaces every key below an any", () => {
      const schema = z.object({ params: z.record(z.string(), z.any()) });

      expect(declaredPath(schema, ["params", "customer", "nested", 2])).toBe(
        "params.<key>.<key>[2]",
      );
    });
  });

  describe("when the schema wraps its fields", () => {
    it("reads through optional, nullable, lazy and pipe", () => {
      const schema = z.object({
        outer: z
          .lazy(() => z.object({ inner: z.string().nullable() }))
          .optional()
          .pipe(z.any()),
      });

      expect(declaredPath(schema, ["outer", "inner"])).toBe("outer.inner");
    });
  });

  describe("when the root itself fails", () => {
    it("labels an empty path as the root", () => {
      expect(declaredPath(z.string(), [])).toBe("<root>");
    });
  });
});
