/**
 * @vitest-environment node
 *
 * The user-default layer as pure logic: how a stored map is read, overlaid on
 * the declared parameters, named as stale, and validated at save time.
 *
 * @see specs/agents/connected-agent-parameter-user-defaults.feature
 */

import { describe, expect, it } from "vitest";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import {
  applyUserParameterDefaults,
  parseAgentParameterDefaults,
  staleParameterDefaultNames,
  validateUserParameterDefault,
} from "../parameter-defaults";

/** Runs the validation and returns the error it threw, or throws if none did. */
function refusalOf(input: Parameters<typeof validateUserParameterDefault>[0]) {
  try {
    validateUserParameterDefault(input);
  } catch (error) {
    return error;
  }
  throw new Error("expected validateUserParameterDefault to throw");
}

const definitions: ScenarioParameterDefinition[] = [
  {
    name: "model",
    type: "string",
    options: ["gpt-4", "gpt-5"],
    defaultValue: "gpt-4",
  },
  { name: "temperature", type: "number", defaultValue: 0.2 },
  { name: "verbose", type: "boolean", defaultValue: false },
];

describe("parseAgentParameterDefaults", () => {
  describe("given a non-object", () => {
    it("reads as no defaults", () => {
      expect(parseAgentParameterDefaults(null)).toEqual({});
      expect(parseAgentParameterDefaults("x")).toEqual({});
      expect(parseAgentParameterDefaults([1, 2])).toEqual({});
    });
  });

  describe("given a map with values of mixed shape", () => {
    it("keeps only string, number and boolean entries", () => {
      expect(
        parseAgentParameterDefaults({
          model: "gpt-5",
          temperature: 0.7,
          verbose: true,
          nested: { a: 1 },
          list: [1],
          nothing: null,
        }),
      ).toEqual({ model: "gpt-5", temperature: 0.7, verbose: true });
    });
  });
});

describe("applyUserParameterDefaults", () => {
  describe("given a user default for a declared parameter", () => {
    it("overlays it onto that parameter's defaultValue and leaves the rest", () => {
      const overlaid = applyUserParameterDefaults({
        definitions,
        userDefaults: { model: "gpt-5" },
      });

      expect(overlaid).toEqual([
        {
          name: "model",
          type: "string",
          options: ["gpt-4", "gpt-5"],
          defaultValue: "gpt-5",
        },
        { name: "temperature", type: "number", defaultValue: 0.2 },
        { name: "verbose", type: "boolean", defaultValue: false },
      ]);
    });
  });

  describe("given a user default whose name no parameter carries", () => {
    it("ignores it, changing no definition", () => {
      const overlaid = applyUserParameterDefaults({
        definitions,
        userDefaults: { plan: "pro" },
      });

      expect(overlaid).toEqual(definitions);
    });
  });

  describe("given a secret parameter with a user default of its name", () => {
    it("leaves the secret parameter untouched", () => {
      const withSecret: ScenarioParameterDefinition[] = [
        { name: "api_token", secret: true },
      ];
      const overlaid = applyUserParameterDefaults({
        definitions: withSecret,
        userDefaults: { api_token: "leaked" },
      });

      expect(overlaid).toEqual(withSecret);
    });
  });
});

describe("staleParameterDefaultNames", () => {
  /** @scenario "A reconnect with a removed parameter shows the override as stale" */
  it("names every user default no current declaration carries", () => {
    expect(
      staleParameterDefaultNames({
        definitions,
        userDefaults: { model: "gpt-5", plan: "pro", region: "eu" },
      }),
    ).toEqual(["plan", "region"]);
  });
});

describe("validateUserParameterDefault", () => {
  describe("when the value is one the declaration accepts", () => {
    it.each([
      { name: "model", value: "gpt-5" as const },
      { name: "temperature", value: 0.9 as const },
      { name: "verbose", value: true as const },
    ])("accepts $name", ({ name, value }) => {
      expect(() =>
        validateUserParameterDefault({ definitions, name, value }),
      ).not.toThrow();
    });
  });

  describe("when the value cannot be accepted", () => {
    it.each([
      {
        label: "undeclared name",
        name: "plan",
        value: "pro",
        reason: "not declared",
      },
      {
        label: "wrong type for a number",
        name: "temperature",
        value: "hot",
        reason: "expected a number",
      },
      {
        label: "wrong type for a boolean",
        name: "verbose",
        value: "yes",
        reason: "expected a boolean",
      },
      {
        label: "wrong type for text",
        name: "model",
        value: 5,
        reason: "expected text",
      },
      {
        label: "value outside the options",
        name: "model",
        value: "gpt-3",
        reason: "must be one of: gpt-4, gpt-5",
      },
    ])("refuses a $label", ({ name, value, reason }) => {
      expect(refusalOf({ definitions, name, value })).toMatchObject({
        code: "agent_parameter_default_invalid",
        meta: { name, reason },
      });
    });

    /** @scenario "A secret parameter cannot have a user default" */
    it("refuses a secret parameter", () => {
      expect(
        refusalOf({
          definitions: [{ name: "api_token", secret: true }],
          name: "api_token",
          value: "x",
        }),
      ).toMatchObject({
        code: "agent_parameter_default_invalid",
        meta: { name: "api_token", reason: "is a secret" },
      });
    });
  });
});
