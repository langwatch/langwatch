import { describe, expect, it } from "vitest";
import { z } from "zod";

import { getSchemaShape } from "../model-provider-credential.ts";

/** Test against real zod schemas; literals can't catch zod schema internals moving. */
describe("getSchemaShape() over schemas zod actually builds", () => {
  const keys = z.object({ OPENAI_API_KEY: z.string(), OPENAI_BASE_URL: z.string() });

  it("reads a plain object's fields", () => {
    expect(Object.keys(getSchemaShape(keys))).toEqual(["OPENAI_API_KEY", "OPENAI_BASE_URL"]);
  });

  it("reads through a refinement, which is how the multi-credential providers declare theirs", () => {
    expect(Object.keys(getSchemaShape(keys.superRefine(() => {})))).toEqual([
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
    ]);
  });

  it("reads through an optional wrapper", () => {
    expect(Object.keys(getSchemaShape(keys.optional()))).toEqual([
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
    ]);
  });

  it("reads through stacked wrappers", () => {
    expect(Object.keys(getSchemaShape(keys.optional().nullable()))).toEqual([
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
    ]);
  });

  it("answers nothing for a schema that has no fields to declare", () => {
    expect(getSchemaShape(z.string())).toEqual({});
  });
});

describe("getSchemaShape()", () => {
  it("returns shape from schema with shape property", () => {
    const schema = {
      shape: { OPENAI_API_KEY: {}, OPENAI_BASE_URL: {} },
    };
    expect(getSchemaShape(schema)).toEqual({
      OPENAI_API_KEY: {},
      OPENAI_BASE_URL: {},
    });
  });

  it("returns shape from nested _def.schema.shape", () => {
    const schema = {
      _def: {
        schema: {
          shape: { ANTHROPIC_API_KEY: {} },
        },
      },
    };
    expect(getSchemaShape(schema)).toEqual({ ANTHROPIC_API_KEY: {} });
  });

  it("returns shape from a wrapped schema via innerType()", () => {
    const schema = {
      innerType: () => ({ shape: { GROQ_API_KEY: {} } }),
    };
    expect(getSchemaShape(schema)).toEqual({ GROQ_API_KEY: {} });
  });

  it("returns empty object for a wrapper whose inner schema has no shape", () => {
    const schema = { innerType: () => ({}) };
    expect(getSchemaShape(schema)).toEqual({});
  });

  it("returns empty object for schema without shape", () => {
    const schema = {};
    expect(getSchemaShape(schema)).toEqual({});
  });

  it("returns empty object for null/undefined", () => {
    expect(getSchemaShape(null)).toEqual({});
    expect(getSchemaShape(undefined)).toEqual({});
  });
});
