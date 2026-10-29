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
    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
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

  describe("when union arms read a segment differently", () => {
    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("keeps a map arm's numeric key out, though an array arm would index it", () => {
      const schema = z.object({
        byId: z.union([z.map(z.number(), z.string()), z.array(z.string())]),
      });

      expect(declaredPath(schema, ["byId", 8675309])).toBe("byId[<key>]");
    });

    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("counts a map arm the union shares with an intersection arm", () => {
      const byNumber = z.map(z.number(), z.string());
      const schema = z.object({
        byId: z.union([z.intersection(z.array(z.string()), byNumber), byNumber]),
      });

      expect(declaredPath(schema, ["byId", 8675309])).toBe("byId[<key>]");
    });

    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("keeps every key below a map out, however deep, though an array arm indexes it", () => {
      const schema = z.object({
        byId: z.union([
          z.map(z.number(), z.map(z.number(), z.string())),
          z.array(z.array(z.string())),
        ]),
      });

      expect(declaredPath(schema, ["byId", 12345, 8675309])).toBe("byId[<key>][<key>]");
    });

    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("keeps a map key's own issue path out, which Zod files under the entry", () => {
      const key = z
        .string()
        .transform((text) => new Map([[Number(text), "bad"]]))
        .pipe(z.map(z.number(), z.number()));
      const schema = z.map(key, z.array(z.string()));
      const parsed = schema.safeParse(new Map([["8675309", []]]));

      const meta = validationMeta(parsed.error, {
        privacy: "schema-only",
        schemaPath: (path) => declaredPath(schema, path),
      });

      expect(meta?.issues.map((issue) => issue.path)).toEqual(["<key>[<key>]"]);
      expect(JSON.stringify(meta)).not.toContain("8675309");
    });

    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("keeps a number out of an intersection unless both sides index it", () => {
      const schema = z.intersection(z.array(z.string()), z.record(z.string(), z.string()));

      expect(declaredPath(schema, [3])).toBe("[<key>]");
    });

    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("keeps a key one object arm declares out when another arm takes any key", () => {
      const schema = z.union([z.object({ email: z.string() }), z.record(z.string(), z.number())]);

      expect(declaredPath(schema, ["email"])).toBe("<key>");
    });

    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("names a key every holding arm declares, ignoring scalar arms", () => {
      const schema = z.union([
        z.object({ id: z.string() }),
        z.object({ id: z.number() }),
        z.string(),
      ]);

      expect(declaredPath(schema, ["id"])).toBe("id");
    });
  });

  describe("when a path passes through a key the schema does not declare", () => {
    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("replaces the key and keeps the rest of the path", () => {
      const schema = z.object({ params: z.record(z.string(), z.object({ id: z.string() })) });

      expect(declaredPath(schema, ["params", "customer-key", "id"])).toBe("params.<key>.id");
    });

    /** @scenario "A refused answer's log names the failing field without the caller's keys" */
    it("replaces every key below an any", () => {
      const schema = z.object({ params: z.record(z.string(), z.any()) });

      expect(declaredPath(schema, ["params", "customer", "nested", 2])).toBe(
        "params.<key>.<key>[<key>]",
      );
    });
  });

  describe("when a number on the path is not an index", () => {
    it("replaces a map's numeric key and a number below an any, keeps array and tuple indices", () => {
      const schema = z.object({
        byId: z.map(z.number(), z.string()),
        list: z.array(z.tuple([z.string(), z.number()])),
        open: z.any(),
      });

      expect(declaredPath(schema, ["byId", 8_675_309])).toBe("byId[<key>]");
      expect(declaredPath(schema, ["list", 2, 1])).toBe("list[2][1]");
      expect(declaredPath(schema, ["open", 42])).toBe("open[<key>]");
    });
  });

  describe("when the schema cannot be opened", () => {
    it("redacts the path rather than throwing", () => {
      const schema = z.object({
        broken: z.lazy((): z.ZodString => {
          throw new Error("lazy getter failed");
        }),
      });

      expect(declaredPath(schema, ["broken", "inner"])).toBe("<redacted>");
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
