import { describe, expect, it } from "vitest";
import {
  isNodeInstrumentationRuntime,
  resolveProcessBootstrapConfig,
} from "../executable-bootstrap.config";
import { AppBootConfigService } from "../config";

describe("executable bootstrap configuration", () => {
  it("projects only boot, logger, and telemetry values from an explicit source", () => {
    const config = resolveProcessBootstrapConfig({
      NODE_ENV: "development",
      PORT: "6560",
      ENVIRONMENT: "preview",
      WORKERS_IN_PROCESS: "1",
      LOG_FORMAT: "pretty",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example///",
      UNRELATED_SECRET: "must not enter the executable graph",
    });

    expect(config).toMatchObject({
      nodeEnv: "development",
      environment: "preview",
    });
    expect(config.logger).toMatchObject({ format: "pretty", deploymentEnvironment: "preview" });
    expect(config.telemetry).toMatchObject({
      otlpEndpoint: "https://collector.example",
      deploymentEnvironment: "preview",
    });
    expect(config).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("keeps existing process defaults and legacy logger fallbacks", () => {
    const config = resolveProcessBootstrapConfig({
      NODE_ENV: "test",
      _LOG_LEVEL: "warn",
      PINO_CONSOLE_LEVEL: "error",
    });

    expect(config).toMatchObject({
      nodeEnv: "test",
      environment: "local",
    });
    expect(config.logger).toMatchObject({ level: "warn", consoleLevel: "error" });
    expect(config.telemetry.otlpEndpoint).toBeUndefined();
  });

  it("keeps task and Next bootstrap independent from HTTP-only boot settings", () => {
    const config = resolveProcessBootstrapConfig({
      NODE_ENV: "test",
      ENVIRONMENT: "",
      PORT: "not-a-port",
      DEV_HTTPS_CERT: "/tmp/dev.pem",
    });

    expect(config.environment).toBe("");
    expect(config.logger.deploymentEnvironment).toBe("");
  });

  it("defers HTTP-only boot validation until the AppBoot boundary", () => {
    expect(() =>
      resolveProcessBootstrapConfig({
        NODE_ENV: "production",
        PORT: "not-a-port",
        DEV_HTTPS_CERT: "/tmp/dev.pem",
      }),
    ).not.toThrow();

    expect(() =>
      new AppBootConfigService().resolve({
        NODE_ENV: "production",
        PORT: "not-a-port",
      }),
    ).toThrow(/Invalid application boot configuration/);
  });

  it("starts Next instrumentation only in its Node runtime", () => {
    expect(isNodeInstrumentationRuntime({ NEXT_RUNTIME: "nodejs" })).toBe(true);
    expect(isNodeInstrumentationRuntime({ NEXT_RUNTIME: "edge" })).toBe(false);
    expect(isNodeInstrumentationRuntime({})).toBe(false);
  });
});
