import { describe, expect, it } from "vitest";
import { DEFAULT_LOGGER_CONFIGURATION, resolveLoggerConfiguration } from "../logger-config";

describe("resolveLoggerConfiguration", () => {
  it("uses deterministic package defaults", () => {
    expect(resolveLoggerConfiguration()).toEqual(DEFAULT_LOGGER_CONFIGURATION);
  });

  it("uses the production JSON default and preserves semantic process identity", () => {
    expect(
      resolveLoggerConfiguration({
        environment: "production",
        serviceName: "langwatch-api",
        serviceVersion: "git-5373dad",
        deploymentEnvironment: "prod-eu",
      }),
    ).toMatchObject({
      format: "json",
      serviceName: "langwatch-api",
      serviceVersion: "git-5373dad",
      deploymentEnvironment: "prod-eu",
    });
  });

  it("preserves explicit console and OTel transport configuration", () => {
    expect(
      resolveLoggerConfiguration({
        format: "pretty",
        level: "warn",
        consoleLevel: "error",
        otelLevel: "info",
        otelExportEnabled: true,
        otelTransportServiceVersion: "1.10.0",
      }),
    ).toMatchObject({
      format: "pretty",
      level: "warn",
      consoleLevel: "error",
      otelLevel: "info",
      otelExportEnabled: true,
      otelTransportServiceVersion: "1.10.0",
    });
  });
});
