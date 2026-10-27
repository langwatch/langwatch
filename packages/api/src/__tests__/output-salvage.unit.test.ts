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

  describe("when a named field carries a value its type refuses", () => {
    /** @scenario "A procedure whose answer breaks its output schema is logged and still answered" */
    it("drops the value rather than send what the schema never allowed there", () => {
      const schema = z.object({
        id: z.string(),
        hasApiKey: z.boolean(),
        kind: z.enum(["a", "b"]),
        gone: z.never().optional(),
      });

      expect(
        withoutUndeclaredKeys(schema, {
          id: "p-1",
          hasApiKey: "sk-stored-value",
          kind: "sk-stored-value",
          gone: "sk-stored-value",
        }),
      ).toEqual({ id: "p-1" });
    });

    it("drops a container where the schema names a primitive", () => {
      const schema = z.object({ id: z.string(), list: z.array(z.string()) }).strict();

      expect(withoutUndeclaredKeys(schema, { id: { secret: "s" }, list: { secret: "s" } })).toEqual(
        {},
      );
    });

    it("drops a null its optional or defaulted field refuses", () => {
      const schema = z.object({
        id: z.string(),
        count: z.number().default(0),
        child: z.object({ id: z.string() }).optional(),
      });

      expect(withoutUndeclaredKeys(schema, { id: 7, count: null, child: null })).toEqual({});
    });

    it("answers nothing when the whole value is the wrong kind", () => {
      expect(withoutUndeclaredKeys(z.object({ id: z.string() }), "secret")).toBeUndefined();
    });
  });

  describe("when the schema is a union no option accepts", () => {
    it("cuts the value by the one option that names most of its keys", () => {
      const schema = z.union([
        z.object({ kind: z.literal("a"), a: z.string() }).strict(),
        z.object({ kind: z.literal("b"), b: z.number(), c: z.number() }).strict(),
      ]);

      expect(withoutUndeclaredKeys(schema, { kind: "b", a: "x", b: 2, c: 1, secret: "s" })).toEqual(
        { kind: "b", b: 2, c: 1 },
      );
    });

    it("cuts a discriminated value by the option its tag names", () => {
      const schema = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("upload"), url: z.string() }).strict(),
        z.object({ kind: z.literal("inline"), body: z.string(), size: z.number() }).strict(),
      ]);

      expect(
        withoutUndeclaredKeys(schema, {
          kind: "upload",
          url: "u",
          body: "b",
          size: 1,
          secret: "s",
        }),
      ).toEqual({ kind: "upload", url: "u" });
    });
  });

  describe("when the schema is an intersection", () => {
    it("keeps the keys either side names", () => {
      const schema = z.intersection(
        z.object({ id: z.string() }).strict(),
        z.object({ name: z.string() }),
      );

      expect(withoutUndeclaredKeys(schema, { id: "i", name: "n", secret: "s" })).toEqual({
        id: "i",
        name: "n",
      });
    });

    it("drops a container when only one side reads it as an object", () => {
      const schema = z.intersection(z.object({ id: z.string() }), z.string());

      expect(withoutUndeclaredKeys(schema, { id: "a", secret: "s" })).toBeUndefined();
    });
  });

  describe("when the schema wraps its object", () => {
    it("cuts through lazy, default, prefault and readonly alike", () => {
      const item = z.object({ id: z.string() }).strict();
      const schema = z
        .object({
          lazy: z.lazy(() => item),
          fallback: item.default({ id: "d" }),
          preset: item.prefault({ id: "p" }),
          frozen: item.readonly(),
        })
        .strict();

      expect(
        withoutUndeclaredKeys(schema, {
          lazy: { id: "1", secret: "s" },
          fallback: { id: "2", secret: "s" },
          preset: { id: "3", secret: "s" },
          frozen: { id: "4", secret: "s" },
        }),
      ).toEqual({
        lazy: { id: "1" },
        fallback: { id: "2" },
        preset: { id: "3" },
        frozen: { id: "4" },
      });
    });
  });

  describe("when the schema answers nothing", () => {
    it("keeps nothing of the handler's value", () => {
      expect(withoutUndeclaredKeys(z.void(), { secret: "s" })).toBeUndefined();
      expect(withoutUndeclaredKeys(z.void(), "s")).toBeUndefined();
    });
  });

  describe("when the schema is a pipe", () => {
    it("cuts the value by the pipe's output side", () => {
      const schema = z
        .object({ id: z.string(), n: z.number() })
        .pipe(z.object({ id: z.string(), n: z.number().positive() }).strict());

      expect(withoutUndeclaredKeys(schema, { id: "a", n: -1, secret: "s" })).toEqual({ id: "a" });
    });

    it("cuts a preprocessed value by the schema after the preprocess", () => {
      const schema = z.preprocess((raw) => raw, z.object({ id: z.string() }).strict());

      expect(withoutUndeclaredKeys(schema, { id: "a", secret: "s" })).toEqual({ id: "a" });
    });

    it("never sends a key a transform exists to remove", () => {
      const schema = z
        .object({ id: z.number(), secret: z.string() })
        .transform(({ secret: _secret, ...rest }) => rest);

      expect(withoutUndeclaredKeys(schema, { id: "1", secret: "S" })).toBeUndefined();
    });

    it("cuts an unknown input by what the pipe answers", () => {
      const schema = z.unknown().pipe(z.object({ id: z.string() }).strict());

      expect(withoutUndeclaredKeys(schema, { id: "a", secret: "s" })).toEqual({ id: "a" });
    });

    it("cuts a codec by its output side", () => {
      const schema = z.codec(z.object({ id: z.string() }), z.object({ id: z.string() }).strict(), {
        decode: (value) => value,
        encode: (value) => value,
      });

      expect(withoutUndeclaredKeys(schema, { id: 1, secret: "s" })).toEqual({});
    });
  });

  describe("when an object declares a catchall", () => {
    it("keeps the other keys, cut by the catchall", () => {
      const schema = z.object({ id: z.string() }).catchall(z.object({ v: z.number() }).strict());

      expect(withoutUndeclaredKeys(schema, { id: "i", extra: { v: 1, secret: "s" } })).toEqual({
        id: "i",
        extra: { v: 1 },
      });
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
