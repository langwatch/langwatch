import { describe, expect, it } from "vitest";
import { z } from "zod";

import { withoutUndeclaredKeys } from "../output-salvage.ts";

describe("withoutUndeclaredKeys", () => {
  describe("when the schema accepts the value", () => {
    it("answers the schema's own parse", () => {
      const schema = z.object({ id: z.string(), at: z.string().transform((raw) => raw.length) });

      expect(withoutUndeclaredKeys(schema, { id: "a", at: "abc", extra: 1 })).toEqual({
        id: "a",
        at: 3,
      });
    });
  });

  describe("when a strict object carries a key it does not name", () => {
    /** @scenario "A procedure whose answer breaks its output schema is logged and still answered" */
    it("drops the key at every depth and keeps the rest of the value", () => {
      const item = z.object({ id: z.string(), tags: z.array(z.string()) }).strict();
      const schema = z
        .object({
          items: z.array(item),
          byId: z.record(z.string(), item),
          next: item.nullable().optional(),
        })
        .strict();

      expect(
        withoutUndeclaredKeys(schema, {
          items: [{ id: "a", tags: ["x"], secret: "s1" }],
          byId: { b: { id: "b", tags: [], secret: "s2" } },
          next: { id: "c", tags: [], secret: "s3" },
          secret: "s4",
        }),
      ).toEqual({
        items: [{ id: "a", tags: ["x"] }],
        byId: { b: { id: "b", tags: [] } },
        next: { id: "c", tags: [] },
      });
    });
  });

  describe("when a field breaks its type beside a key nothing names", () => {
    it("keeps the broken field and drops the unnamed key", () => {
      const schema = z.object({ id: z.string(), count: z.number() });

      expect(withoutUndeclaredKeys(schema, { id: 7, count: 1, secret: "s" })).toEqual({
        id: 7,
        count: 1,
      });
    });
  });

  describe("when the schema is a union no option accepts", () => {
    it("keeps the keys some object option names", () => {
      const schema = z.union([
        z.object({ kind: z.literal("a"), a: z.string() }).strict(),
        z.object({ kind: z.literal("b"), b: z.number() }).strict(),
      ]);

      expect(withoutUndeclaredKeys(schema, { kind: "c", a: "x", b: "y", secret: "s" })).toEqual({
        kind: "c",
        a: "x",
        b: "y",
      });
    });
  });

  describe("when the schema is a pipe", () => {
    it("cuts the value by the pipe's input side", () => {
      const schema = z
        .object({ id: z.string(), n: z.number() })
        .strict()
        .pipe(z.object({ id: z.string(), n: z.number().positive() }));

      expect(withoutUndeclaredKeys(schema, { id: "a", n: -1, secret: "s" })).toEqual({
        id: "a",
        n: -1,
      });
    });
  });

  describe("when an object declares a catchall", () => {
    it("keeps the other keys, cut by the catchall", () => {
      const schema = z.object({ id: z.string() }).catchall(z.object({ v: z.number() }).strict());

      expect(withoutUndeclaredKeys(schema, { id: 1, extra: { v: 1, secret: "s" } })).toEqual({
        id: 1,
        extra: { v: 1 },
      });
    });
  });
});
