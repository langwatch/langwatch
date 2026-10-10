/** @vitest-environment node
 * @spec specs/setup/process-telemetry.feature
 */
import { describe, expect, it } from "vitest";

import { buildChildEnvironment } from "../features/child/services/node-scenario-child.service.ts";

const config = {
  packageRoot: "/app",
  sourcePath: "/app/src/child.ts",
  sourceRoots: ["/app/src"],
  nodeEnv: "test",
  isSaas: false,
  voicePublicUrl: { url: "https://voice.example.com" },
  baseHost: "https://app.example.com",
  egress: { blockLocal: false, allowedHosts: [] },
  parentEnvironment: {
    logSettings: {
      LOG_LEVEL: "warn",
      LOG_FORMAT: "json",
      PINO_LOG_LEVEL: "info",
    },
  },
};

describe("buildChildEnvironment telemetry", () => {
  /** @scenario "The child's environment carries the log settings and no collector credential" */
  it("passes log level and format names and no collector endpoint or headers", () => {
    const result = buildChildEnvironment({
      config,
      jobData: {
        projectId: "p",
        scenarioId: "s",
        scenarioRunId: "r",
        batchRunId: "b",
        setId: "set",
        target: { type: "http", referenceId: "a" },
      },
      labels: [],
      telemetry: { endpoint: "http://app:5560", apiKey: "key" },
    });

    expect(result.LOG_LEVEL).toBe("warn");
    expect(result.LOG_FORMAT).toBe("json");
    expect(result.PINO_LOG_LEVEL).toBe("info");
    expect(result.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(result.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
  });
});
