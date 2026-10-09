/**
 * The parameter schema: the three accepted forms, the refusal of a schema
 * library instance, and the validation of incoming values.
 *
 * @see specs/typescript-sdk/agent-wrapper.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AgentParameterError,
  parameterSpecsFromSchema,
  resolveParameterValues,
  toParameterSchema,
} from "../schema";

describe("toParameterSchema()", () => {
  describe("when given a definition map", () => {
    /** @scenario "A definition map becomes a JSON Schema object" */
    it("builds an object schema with one property per parameter and no required list", () => {
      const schema = toParameterSchema({
        model: { options: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini" },
        plan: { default: "free", description: "Customer plan" },
        maxTools: { type: "number", default: 5 },
      });

      expect(schema).toEqual({
        type: "object",
        properties: {
          model: { type: "string", enum: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini" },
          plan: { type: "string", default: "free", description: "Customer plan" },
          maxTools: { type: "number", default: 5 },
        },
      });
    });

    /** @scenario "A parameter with no default is required" */
    it("lists a parameter with no default as required", () => {
      const schema = toParameterSchema({
        plan: { description: "The plan" },
      });

      expect(schema.required).toEqual(["plan"]);
      expect(schema.properties).toEqual({
        plan: { type: "string", description: "The plan" },
      });
    });

    it("reads the type from a boolean default", () => {
      const schema = toParameterSchema({ verbose: { default: false } });
      expect((schema.properties as Record<string, unknown>).verbose).toEqual({
        type: "boolean",
        default: false,
      });
    });
  });

  describe("when given a Standard JSON Schema object", () => {
    /** @scenario "A Standard JSON Schema object is read through its jsonSchema converter" */
    it("uses the converter output as the parameter schema", () => {
      const converted = { type: "object", properties: { model: { type: "string" } } };
      const standard = {
        "~standard": {
          version: 1,
          vendor: "test",
          jsonSchema: { input: () => converted, output: () => converted },
        },
      };

      expect(toParameterSchema(standard)).toBe(converted);
    });

    it("reads a zod 4 schema through the same interface without touching zod", () => {
      const schema = toParameterSchema(
        z.object({ model: z.enum(["gpt-5", "gpt-5-mini"]).default("gpt-5-mini"), plan: z.string() }),
      );

      expect(schema.type).toBe("object");
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      expect(properties.model?.enum).toEqual(["gpt-5", "gpt-5-mini"]);
      expect(properties.model?.default).toBe("gpt-5-mini");
      expect(schema.required).toEqual(["plan"]);
    });
  });

  describe("when given a plain JSON Schema", () => {
    /** @scenario "A plain JSON Schema is used as is" */
    it("returns it unchanged", () => {
      const schema = { type: "object", properties: { plan: { type: "string", default: "free" } } };
      expect(toParameterSchema(schema)).toBe(schema);
    });
  });

  describe("when given a schema library instance with no JSON Schema converter", () => {
    /** @scenario "A schema object with no JSON Schema converter is refused" */
    it("refuses it and names the three accepted forms", () => {
      const fakeZod3 = { _def: { typeName: "ZodObject" }, parse: () => ({}) };

      expect(() => toParameterSchema(fakeZod3 as never)).toThrow(AgentParameterError);
      expect(() => toParameterSchema(fakeZod3 as never)).toThrow(
        /definition map.*Standard JSON Schema.*JSON Schema object/,
      );
    });
  });

  describe("when no parameters are given", () => {
    it("is an object schema with no properties", () => {
      expect(toParameterSchema(undefined)).toEqual({ type: "object", properties: {} });
    });
  });
});

describe("parameterSpecsFromSchema()", () => {
  it("reads type, options, default, description and required per property", () => {
    const specs = parameterSpecsFromSchema({
      type: "object",
      properties: {
        model: { type: "string", enum: ["a", "b"], default: "a" },
        retries: { type: "integer", description: "How many" },
        token: { type: "string" },
        weird: { type: ["number", "null"] },
        blob: { type: "object" },
      },
      required: ["retries", "token"],
    });

    expect(specs).toEqual([
      { name: "model", type: "string", options: ["a", "b"], default: "a", required: false },
      { name: "retries", type: "number", description: "How many", required: true },
      { name: "token", type: "string", required: true },
      { name: "weird", type: "number", required: false },
      { name: "blob", type: "string", required: false },
    ]);
  });
});

describe("resolveParameterValues()", () => {
  const specs = parameterSpecsFromSchema(
    toParameterSchema({
      model: { options: ["gpt-5", "gpt-5-mini"], default: "gpt-5-mini" },
      maxTools: { type: "number", default: 5 },
      verbose: { default: false },
      plan: { description: "no default" },
    }),
  );

  describe("when a value is missing", () => {
    /** @scenario "A missing parameter takes its default" */
    it("fills the default", () => {
      const values = resolveParameterValues({ specs, supplied: { plan: "pro" } });
      expect(values).toEqual({ model: "gpt-5-mini", maxTools: 5, verbose: false, plan: "pro" });
    });

    /** @scenario "A required parameter the run did not supply is refused before the call" */
    it("refuses a required parameter by name", () => {
      expect(() => resolveParameterValues({ specs, supplied: {} })).toThrow(/"plan" is required/);
    });
  });

  describe("when a value is outside the options", () => {
    /** @scenario "A value outside the options is refused before the call" */
    it("refuses it with agent_parameter_invalid", () => {
      let caught: unknown;
      try {
        resolveParameterValues({ specs, supplied: { plan: "pro", model: "gpt-4" } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AgentParameterError);
      expect((caught as AgentParameterError).code).toBe("agent_parameter_invalid");
      expect((caught as Error).message).toMatch(/"model" must be one of gpt-5, gpt-5-mini/);
    });
  });

  describe("when a number arrives as text", () => {
    /** @scenario "A number parameter reads a numeric string" */
    it("reads the number", () => {
      const values = resolveParameterValues({ specs, supplied: { plan: "pro", maxTools: "7" } });
      expect(values.maxTools).toBe(7);
    });

    it("refuses text that is not a number", () => {
      expect(() => resolveParameterValues({ specs, supplied: { plan: "pro", maxTools: "many" } })).toThrow(
        /"maxTools" must be a number/,
      );
    });
  });

  describe("when a boolean arrives as text", () => {
    it("reads true and false and refuses anything else", () => {
      expect(resolveParameterValues({ specs, supplied: { plan: "pro", verbose: "true" } }).verbose).toBe(true);
      expect(() => resolveParameterValues({ specs, supplied: { plan: "pro", verbose: "yes" } })).toThrow(
        /"verbose" must be true or false/,
      );
    });
  });

  describe("when the run supplies a name the schema does not declare", () => {
    it("passes it through", () => {
      const values = resolveParameterValues({ specs, supplied: { plan: "pro", extra: "x" } });
      expect(values.extra).toBe("x");
    });
  });
});
