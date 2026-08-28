import { InvalidRuntimeConfigError } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "../src/platform/config/worker.config";

describe("resolveWorkerConfig", () => {
  it("uses the worker-local environment default", () => {
    const config = resolveWorkerConfig({});

    expect(config).toEqual({ environment: "local" });
  });

  it("reads a semantic environment value from its process source", () => {
    const config = resolveWorkerConfig({ ENVIRONMENT: "production" });

    expect(config).toEqual({ environment: "production" });
  });

  it("rejects invalid configuration before a worker graph can boot", () => {
    expect(() => resolveWorkerConfig({ ENVIRONMENT: "" })).toThrow(InvalidRuntimeConfigError);
  });
});
