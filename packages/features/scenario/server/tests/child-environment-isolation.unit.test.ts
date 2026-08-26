import { afterEach, describe, expect, it } from "vitest";
import {
  buildChildEnvironment,
  type ExecutionJobData,
  type ScenarioChildProcessConfig,
} from "../src";

const parentKeys = [
  "LANGWATCH_API_KEY",
  "LANGWATCH_ENDPOINT",
  "LANGWATCH_OTHER_TENANT",
  "NODE_OPTIONS",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_SERVICE_NAME",
  "TRACEPARENT",
] as const;

const original = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of parentKeys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  original.clear();
});

function setParentEnvironment(key: (typeof parentKeys)[number], value: string): void {
  if (!original.has(key)) original.set(key, process.env[key]);
  process.env[key] = value;
}

function job(projectId: string, runId: string): ExecutionJobData {
  return {
    projectId,
    scenarioId: `scenario-${projectId}`,
    scenarioRunId: runId,
    batchRunId: `batch-${projectId}`,
    setId: `set-${projectId}`,
    target: { type: "http", referenceId: `agent-${projectId}` },
  };
}

const config: ScenarioChildProcessConfig = {
  packageRoot: "/app/platform/app",
  sourcePath: "/app/platform/app/src/runtime/worker/scenario-child-process.ts",
  sourceRoots: ["/app/packages/features/scenario/server/src"],
  nodeEnv: "production",
  isSaas: true,
  parentEnvironment: {
    path: "/usr/bin",
    home: "/app",
    lang: "en_US.UTF-8",
  },
};

describe("Scenario child environment isolation", () => {
  it("does not inherit parent telemetry, trace context or Node preloads", () => {
    for (const key of parentKeys) setParentEnvironment(key, `parent-${key}`);

    const environment = buildChildEnvironment({
      config,
      jobData: job("project-a", "run-a"),
      labels: ["smoke"],
      telemetry: { endpoint: "https://project-a.test", apiKey: "key-a" },
    });

    expect(environment).not.toHaveProperty("NODE_OPTIONS");
    expect(environment).not.toHaveProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(environment).not.toHaveProperty("OTEL_EXPORTER_OTLP_HEADERS");
    expect(environment).not.toHaveProperty("OTEL_SERVICE_NAME");
    expect(environment).not.toHaveProperty("TRACEPARENT");
    expect(environment).not.toHaveProperty("LANGWATCH_OTHER_TENANT");
    expect(environment.LANGWATCH_API_KEY).toBe("key-a");
    expect(environment.LANGWATCH_ENDPOINT).toBe("https://project-a.test");
  });

  it("keeps tenant telemetry and resource attributes separate between children", () => {
    const first = buildChildEnvironment({
      config,
      jobData: job("project-a", "run-a"),
      labels: ["tenant-a"],
      telemetry: { endpoint: "https://project-a.test", apiKey: "key-a" },
    });
    const second = buildChildEnvironment({
      config,
      jobData: job("project-b", "run-b"),
      labels: ["tenant-b"],
      telemetry: { endpoint: "https://project-b.test", apiKey: "key-b" },
    });

    expect(first.LANGWATCH_API_KEY).toBe("key-a");
    expect(first.LANGWATCH_ENDPOINT).toBe("https://project-a.test");
    expect(first.OTEL_RESOURCE_ATTRIBUTES).toContain("scenario.labels=tenant-a");
    expect(first.OTEL_RESOURCE_ATTRIBUTES).not.toContain("tenant-b");
    expect(second.LANGWATCH_API_KEY).toBe("key-b");
    expect(second.LANGWATCH_ENDPOINT).toBe("https://project-b.test");
    expect(second.OTEL_RESOURCE_ATTRIBUTES).toContain("scenario.labels=tenant-b");
    expect(second.OTEL_RESOURCE_ATTRIBUTES).not.toContain("tenant-a");
  });
});
