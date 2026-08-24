import {
  runParameterValuesSchema,
  scenarioParameterDefinitionsSchema,
} from "../src";
import { describe, expect, it } from "vitest";

describe("Scenario contract", () => {
  it("refuses defaults on secret parameters", () => {
    const parsed = scenarioParameterDefinitionsSchema.safeParse([
      { name: "api_token", secret: true, defaultValue: "not-a-secret" },
    ]);

    expect(parsed.success).toBe(false);
  });

  it("refuses prototype-sensitive supplied parameter names", () => {
    const parsed = runParameterValuesSchema.safeParse(
      JSON.parse('{"__proto__":"unsafe"}'),
    );

    expect(parsed.success).toBe(false);
  });
});
