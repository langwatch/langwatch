import { describe, expect, it } from "vitest";
import {
  requireScenarioChildTelemetry,
  resolveScenarioChildProcessConfig,
} from "../scenario-child.config";
import { parseScenarioChildInput } from "../scenario-child.input";

describe("scenario child process configuration", () => {
  it("fails before child work when either required telemetry value is missing", () => {
    expect(() =>
      requireScenarioChildTelemetry(
        resolveScenarioChildProcessConfig({ LANGWATCH_ENDPOINT: "https://langwatch.test" }),
      ),
    ).toThrow("LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env");
    expect(() =>
      requireScenarioChildTelemetry(
        resolveScenarioChildProcessConfig({ LANGWATCH_API_KEY: "project-api-key" }),
      ),
    ).toThrow("LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env");
  });

  it("keeps the exact true-only verbose and tolerant log-context behaviour", () => {
    expect(
      resolveScenarioChildProcessConfig({
        LANGWATCH_ENDPOINT: "https://langwatch.test",
        LANGWATCH_API_KEY: "project-api-key",
        SCENARIO_VERBOSE: "true",
        LANGWATCH_LOG_CONTEXT: '{"scenarioRunId":"run-1"}',
      }),
    ).toMatchObject({
      langwatchEndpoint: "https://langwatch.test",
      langwatchApiKey: "project-api-key",
      verbose: true,
      logContext: { scenarioRunId: "run-1" },
    });
    expect(
      resolveScenarioChildProcessConfig({
        LANGWATCH_ENDPOINT: "https://langwatch.test",
        LANGWATCH_API_KEY: "project-api-key",
        SCENARIO_VERBOSE: "TRUE",
      }).verbose,
    ).toBe(false);
  });

  it("parses the child job before rejecting absent telemetry", () => {
    const config = resolveScenarioChildProcessConfig({});

    expect(() => parseScenarioChildInput({ raw: "not-json", config })).toThrow(SyntaxError);
  });
});
