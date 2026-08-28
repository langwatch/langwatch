import { InvalidRuntimeConfigError } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "../src/platform/config/worker.config";

describe("resolveWorkerConfig", () => {
  it("uses the worker-local environment default", () => {
    const config = resolveWorkerConfig({});

    expect(config).toEqual({ environment: "local", nodeEnvironment: "development" });
  });

  it("reads a semantic environment value from its process source", () => {
    const config = resolveWorkerConfig({ ENVIRONMENT: "production" });

    expect(config).toEqual({ environment: "production", nodeEnvironment: "development" });
  });

  it("parses the production runtime mode used for Eventing diagnostics", () => {
    const config = resolveWorkerConfig({ NODE_ENV: "production" });

    expect(config.nodeEnvironment).toBe("production");
  });

  it("rejects invalid configuration before a worker graph can boot", () => {
    expect(() => resolveWorkerConfig({ ENVIRONMENT: "" })).toThrow(InvalidRuntimeConfigError);
  });
});
