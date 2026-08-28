import { describe, expect, it } from "vitest";
import { getSchemaShape } from "../src/model-provider-credential";

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
