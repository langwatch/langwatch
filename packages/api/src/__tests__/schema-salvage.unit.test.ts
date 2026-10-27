import { describe, expect, it } from "vitest";
import { z } from "zod";

import { withoutUndeclaredKeys } from "../schema.ts";

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
    it("cuts the value by the one option that names most of its keys", () => {
      const schema = z.union([
        z.object({ kind: z.literal("a"), a: z.string() }).strict(),
        z.object({ kind: z.literal("b"), b: z.number(), c: z.number() }).strict(),
      ]);

      expect(
        withoutUndeclaredKeys(schema, { kind: "x", a: "x", b: "y", c: 1, secret: "s" }),
      ).toEqual({ kind: "x", b: "y", c: 1 });
    });

    it("cuts a discriminated value by the option its tag names", () => {
      const schema = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("upload"), url: z.string() }).strict(),
        z.object({ kind: z.literal("inline"), body: z.string(), size: z.number() }).strict(),
      ]);

      expect(
        withoutUndeclaredKeys(schema, { kind: "upload", url: 7, body: "b", size: 1, secret: "s" }),
      ).toEqual({ kind: "upload", url: 7 });
    });
  });

  describe("when the schema is an intersection", () => {
    it("keeps the keys either side names", () => {
      const schema = z.intersection(
        z.object({ id: z.string() }).strict(),
        z.object({ name: z.string() }),
      );

      expect(withoutUndeclaredKeys(schema, { id: 1, name: "n", secret: "s" })).toEqual({
        id: 1,
        name: "n",
      });
    });

    it("drops a container when only one side reads it as an object", () => {
      const schema = z.intersection(z.object({ id: z.string() }), z.string());

      expect(withoutUndeclaredKeys(schema, { id: "a", secret: "s" })).toBeUndefined();
    });
  });

  describe("when the schema wraps its object", () => {
    it("cuts through lazy, default and readonly alike", () => {
      const item = z.object({ id: z.string() }).strict();
      const schema = z
        .object({
          lazy: z.lazy(() => item),
          fallback: item.default({ id: "d" }),
          frozen: item.readonly(),
        })
        .strict();

      expect(
        withoutUndeclaredKeys(schema, {
          lazy: { id: 1, secret: "s" },
          fallback: { id: 2, secret: "s" },
          frozen: { id: 3, secret: "s" },
        }),
      ).toEqual({ lazy: { id: 1 }, fallback: { id: 2 }, frozen: { id: 3 } });
    });
  });

  describe("when the schema answers nothing", () => {
    it("keeps nothing of the handler's value", () => {
      expect(withoutUndeclaredKeys(z.void(), { secret: "s" })).toBeUndefined();
      expect(withoutUndeclaredKeys(z.void(), "s")).toBeUndefined();
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

  describe("when a preprocess step owns the pipe's input side", () => {
    it("cuts the value by the pipe's output side", () => {
      const schema = z.preprocess((raw) => raw, z.object({ id: z.string() }).strict());

      expect(withoutUndeclaredKeys(schema, { id: 7, secret: "s" })).toEqual({ id: 7 });
    });
  });

  describe("when a container arrives where the schema expects a primitive", () => {
    it("drops the container rather than send keys nothing names", () => {
      const schema = z.object({ id: z.string(), list: z.array(z.string()) }).strict();

      expect(withoutUndeclaredKeys(schema, { id: { secret: "s" }, list: { secret: "s" } })).toEqual(
        { id: undefined, list: undefined },
      );
    });
  });

  describe("when a record carries a key its key schema refuses", () => {
    it("drops that key", () => {
      const schema = z.record(z.enum(["public"]), z.string());

      expect(withoutUndeclaredKeys(schema, { public: "ok", secret: "s" })).toEqual({
        public: "ok",
      });
    });
  });
});
