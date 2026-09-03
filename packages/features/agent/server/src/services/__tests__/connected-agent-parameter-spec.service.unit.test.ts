/**
 * The SDK's JSON Schema, normalized into parameter definitions.
 *
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";
import { normalizeParameterSchema } from "../connected-agent-parameter-spec.service";

describe("normalizeParameterSchema", () => {
  describe("when the schema declares scalar properties", () => {
    /** @scenario "A JSON Schema object becomes parameter definitions" */
    it("reads the type, the options, the default and the required flag", () => {
      const { parameters, notes } = normalizeParameterSchema({
        type: "object",
        properties: {
          model: {
            type: "string",
            enum: ["gpt-5-mini", "gpt-5"],
            description: "The model",
          },
          temperature: { type: "number", default: 0.2 },
          verbose: { type: "boolean" },
        },
        required: ["model"],
      });

      expect(notes).toEqual([]);
      expect(parameters).toEqual([
        {
          name: "model",
          type: "string",
          description: "The model",
          options: ["gpt-5-mini", "gpt-5"],
          required: true,
        },
        { name: "temperature", type: "number", defaultValue: 0.2 },
        { name: "verbose", type: "boolean" },
      ]);
    });

    it("reads an integer as a number and an optional as its type", () => {
      const { parameters } = normalizeParameterSchema({
        properties: {
          retries: { type: "integer", default: 3 },
          region: { type: ["string", "null"] },
        },
      });
      expect(parameters).toEqual([
        { name: "retries", type: "number", defaultValue: 3 },
        { name: "region", type: "string" },
      ]);
    });
  });

  describe("when a property has an unsupported type", () => {
    /** @scenario "An unsupported property type is downgraded to text with a note" */
    it("presents it as a string and says so", () => {
      const { parameters, notes } = normalizeParameterSchema({
        properties: { filters: { type: "object" } },
      });
      expect(parameters).toEqual([{ name: "filters", type: "string" }]);
      expect(notes).toEqual([
        '"filters": the type "object" is not supported and is presented as text',
      ]);
    });
  });

  describe("when a name breaks the grammar", () => {
    /** @scenario "A parameter name outside the grammar is refused" */
    it("refuses with agent_parameter_invalid", () => {
      expect(() =>
        normalizeParameterSchema({
          properties: { "my-model": { type: "string" } },
        }),
      ).toThrow(expect.objectContaining({ code: "agent_parameter_invalid" }));
    });
  });

  describe("when more than twenty properties are declared", () => {
    /** @scenario "More than twenty parameters are refused" */
    it("refuses with agent_parameter_invalid", () => {
      const properties = Object.fromEntries(
        Array.from({ length: 21 }, (_, index) => [`param_${index}`, { type: "string" }]),
      );
      expect(() => normalizeParameterSchema({ properties })).toThrow(
        expect.objectContaining({ code: "agent_parameter_invalid" }),
      );
      expect(
        normalizeParameterSchema({
          properties: Object.fromEntries(Object.entries(properties).slice(0, 20)),
        }).parameters,
      ).toHaveLength(20);
    });
  });

  describe("when an enum holds more than fifty values", () => {
    /** @scenario "More than fifty options are cut to fifty with a note" */
    it("keeps the first fifty and says so", () => {
      const { parameters, notes } = normalizeParameterSchema({
        properties: {
          voice: {
            type: "string",
            enum: Array.from({ length: 60 }, (_, index) => `voice_${index}`),
          },
        },
      });
      expect(parameters[0]?.options).toHaveLength(50);
      expect(notes).toEqual(['"voice": the option list was cut to the first 50 of 60 values']);
    });
  });

  describe("when a property is named after a turn field", () => {
    /** @scenario "A turn field name is never a parameter" */
    it("refuses with agent_parameter_invalid", () => {
      for (const name of ["messages", "thread_id", "session", "new_messages"]) {
        expect(() =>
          normalizeParameterSchema({
            properties: { [name]: { type: "string" } },
          }),
        ).toThrow(expect.objectContaining({ code: "agent_parameter_invalid" }));
      }
    });
  });

  describe("when a property is declared secret", () => {
    it("refuses it: secrets stay scenario-declared", () => {
      expect(() =>
        normalizeParameterSchema({
          properties: { token: { type: "string", secret: true } },
        }),
      ).toThrow(expect.objectContaining({ code: "agent_parameter_invalid" }));
      expect(
        normalizeParameterSchema({
          properties: { token: { type: "string" } },
        }).parameters[0],
      ).not.toHaveProperty("secret");
    });
  });
});
