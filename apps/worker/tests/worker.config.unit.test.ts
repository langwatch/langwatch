import { InvalidRuntimeConfigError } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "../src/platform/config/worker.config";

describe("resolveWorkerConfig", () => {
  it("uses the worker-local environment default", () => {
    const config = resolveWorkerConfig({});

    expect(config).toEqual({
      processRole: "worker",
      environment: "local",
      nodeEnvironment: "development",
      serviceName: "langwatch:worker",
      serviceVersion: undefined,
      logger: {
        format: undefined,
        level: undefined,
        consoleLevel: undefined,
        otelExportEnabled: undefined,
      },
      observability: {
        apiKey: undefined,
        endpoint: undefined,
        processorType: "batch",
      },
      eventing: { consumersEnabled: false },
    });
  });

  it("reads a semantic environment value from its process source", () => {
    const config = resolveWorkerConfig({ ENVIRONMENT: "production" });

    expect(config.environment).toBe("production");
    expect(config.nodeEnvironment).toBe("development");
    expect(config.eventing.consumersEnabled).toBe(false);
  });

  it("parses tracing credentials at the process boundary without exposing them in errors", () => {
    const config = resolveWorkerConfig({
      LANGWATCH_API_KEY: "key-for-worker",
      LANGWATCH_ENDPOINT: "https://collector.example.test",
      LANGWATCH_PROCESSOR_TYPE: "simple",
    });

    expect(config.observability).toEqual({
      apiKey: "key-for-worker",
      endpoint: "https://collector.example.test",
      processorType: "simple",
    });
  });

  it("parses the production runtime mode used for Eventing diagnostics", () => {
    const config = resolveWorkerConfig({ NODE_ENV: "production" });

    expect(config.nodeEnvironment).toBe("production");
  });

  it("rejects invalid configuration before a worker graph can boot", () => {
    expect(() => resolveWorkerConfig({ ENVIRONMENT: "" })).toThrow(InvalidRuntimeConfigError);
  });

  it("fails closed when a deployment assigns the worker a web role", () => {
    expect(() => resolveWorkerConfig({ WORKER_PROCESS_ROLE: "web" })).toThrow(
      InvalidRuntimeConfigError,
    );
  });

  it("fails closed when a deployment attempts to enable partial consumers", () => {
    expect(() => resolveWorkerConfig({ WORKER_EVENTING_CONSUMERS_ENABLED: "true" })).toThrow(
      InvalidRuntimeConfigError,
    );
  });
});
